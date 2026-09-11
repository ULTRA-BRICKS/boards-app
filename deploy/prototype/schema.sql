-- Apply only to the separate boards_prototype database, after Neon Auth/Data API
-- have created the anonymous/authenticated roles. Never apply to scriptboard.
CREATE SCHEMA IF NOT EXISTS prototype_api;
CREATE SCHEMA IF NOT EXISTS prototype_private;
REVOKE ALL ON SCHEMA prototype_private FROM PUBLIC, anonymous, authenticated;
CREATE TABLE IF NOT EXISTS prototype_private.notebooks (
  key_hash bytea PRIMARY KEY, version bigint NOT NULL DEFAULT 1,
  document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(octet_length(document::text)<=524288)
);
CREATE TABLE IF NOT EXISTS prototype_private.shares (
  token_hash bytea PRIMARY KEY,
  key_hash bytea NOT NULL REFERENCES prototype_private.notebooks,
  scope jsonb NOT NULL, revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA prototype_private FROM PUBLIC, anonymous, authenticated;
GRANT USAGE ON SCHEMA prototype_api TO anonymous, authenticated;

CREATE OR REPLACE FUNCTION prototype_private.validate_document(doc jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE b jsonb; c jsonb; t jsonb; p jsonb; ids text[]; pids text[]:='{}'; total integer;
BEGIN
  IF doc IS NULL OR jsonb_typeof(doc)<>'object'
    OR doc->>'schemaVersion' IS DISTINCT FROM '2'
    OR jsonb_typeof(doc->'boards') IS DISTINCT FROM 'array'
    OR jsonb_typeof(doc->'people') IS DISTINCT FROM 'array'
    OR octet_length(doc::text)>524288
  THEN RAISE EXCEPTION 'Invalid workspace' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(doc->'boards') NOT BETWEEN 1 AND 30
    OR jsonb_array_length(doc->'people')>100
  THEN RAISE EXCEPTION 'Workspace limit' USING ERRCODE='22023'; END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(doc->'people') LOOP
    IF coalesce(p->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' OR p->>'id'=ANY(pids)
      OR length(coalesce(p->>'name','')) NOT BETWEEN 1 AND 120
      OR length(coalesce(p->>'email',''))>200
      OR length(coalesce(p->>'avatar',''))>120000
    THEN RAISE EXCEPTION 'Invalid person' USING ERRCODE='22023'; END IF;
    pids:=array_append(pids,p->>'id');
  END LOOP;
  ids:='{}';
  FOR b IN SELECT value FROM jsonb_array_elements(doc->'boards') LOOP
    IF coalesce(b->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' OR b->>'id'=ANY(ids)
      OR jsonb_typeof(b->'columns') IS DISTINCT FROM 'array'
      OR length(coalesce(b->>'title',''))>120
    THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
    ids:=array_append(ids,b->>'id'); total:=0;
    IF jsonb_array_length(b->'columns')>24 THEN RAISE EXCEPTION 'Too many columns' USING ERRCODE='22023'; END IF;
    FOR c IN SELECT value FROM jsonb_array_elements(b->'columns') LOOP
      IF coalesce(c->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' OR c->>'id'=ANY(ids)
        OR length(coalesce(c->>'title',''))>120
        OR length(coalesce(c->>'subtitle',''))>180
        OR length(coalesce(c->>'note',''))>240
        OR jsonb_typeof(c->'items') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'Invalid column' USING ERRCODE='22023'; END IF;
      ids:=array_append(ids,c->>'id');
      IF jsonb_array_length(c->'items')>200 THEN RAISE EXCEPTION 'Too many items' USING ERRCODE='22023'; END IF;
      total:=total+jsonb_array_length(c->'items');
      FOR t IN SELECT value FROM jsonb_array_elements(c->'items') LOOP
        IF coalesce(t->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' OR t->>'id'=ANY(ids)
          OR jsonb_typeof(t->'text') IS DISTINCT FROM 'string' OR length(t->>'text')>1000
          OR jsonb_typeof(t->'done') IS DISTINCT FROM 'boolean'
          OR jsonb_typeof(t->'assignees') IS DISTINCT FROM 'array'
        THEN RAISE EXCEPTION 'Invalid item' USING ERRCODE='22023'; END IF;
        IF jsonb_array_length(t->'assignees')>12 OR EXISTS(
          SELECT 1 FROM jsonb_array_elements_text(t->'assignees') a WHERE a IS NULL OR NOT a=ANY(pids)
        ) THEN RAISE EXCEPTION 'Invalid assignment' USING ERRCODE='22023'; END IF;
        ids:=array_append(ids,t->>'id');
      END LOOP;
    END LOOP;
    IF total>1200 THEN RAISE EXCEPTION 'Page limit' USING ERRCODE='22023'; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION prototype_private.validate_document(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION prototype_api.notebook(
  capability text, expected_version bigint DEFAULT NULL, document jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k bytea; rec prototype_private.notebooks; v bigint;
BEGIN
  IF capability IS NULL OR capability !~ '^[A-Za-z0-9_-]{43,86}$'
  THEN RAISE EXCEPTION 'Notebook key required' USING ERRCODE='42501'; END IF;
  k:=sha256(convert_to(capability,'UTF8'));
  IF document IS NULL THEN
    SELECT * INTO rec FROM prototype_private.notebooks WHERE key_hash=k;
    IF NOT FOUND THEN RAISE EXCEPTION 'Notebook unavailable' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('version',rec.version,'value',rec.document);
  END IF;
  PERFORM prototype_private.validate_document(document);
  IF expected_version=0 THEN
    PERFORM pg_advisory_xact_lock(782386925);
    IF (SELECT count(*) FROM prototype_private.notebooks)>=200
    THEN RAISE EXCEPTION 'Prototype capacity reached' USING ERRCODE='54000'; END IF;
    INSERT INTO prototype_private.notebooks(key_hash,document) VALUES(k,notebook.document)
      ON CONFLICT DO NOTHING RETURNING version INTO v;
  ELSE
    UPDATE prototype_private.notebooks
      SET document=notebook.document,version=version+1,updated_at=now()
      WHERE key_hash=k AND version=expected_version RETURNING version INTO v;
  END IF;
  IF v IS NULL THEN RAISE EXCEPTION 'Another session changed this page. Reload or export your draft.' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('version',v);
END $$;
REVOKE ALL ON FUNCTION prototype_api.notebook(text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prototype_api.notebook(text,bigint,jsonb) TO anonymous,authenticated;

CREATE OR REPLACE FUNCTION prototype_private.project_view(doc jsonb, scope jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE kind text:=scope->>'kind'; b jsonb; c jsonb; t jsonb;
  result_boards jsonb:='[]'; result_columns jsonb; result_items jsonb; near_ids jsonb:='[]';
  wanted text[]:='{}'; seen text[]:='{}'; ids text[]; i integer; include_item boolean;
  boards_seen integer:=0; columns_seen integer:=0; result_people jsonb;
BEGIN
  IF kind IS NULL OR kind NOT IN ('space','board','column','item','items')
  THEN RAISE EXCEPTION 'Invalid scope' USING ERRCODE='22023'; END IF;
  IF kind IN ('item','items') THEN
    IF jsonb_typeof(scope->'itemIds') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Select items' USING ERRCODE='22023'; END IF;
    SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO wanted FROM jsonb_array_elements_text(scope->'itemIds');
    IF cardinality(wanted) NOT BETWEEN 1 AND 50 OR (kind='item' AND cardinality(wanted)<>1)
    THEN RAISE EXCEPTION 'Invalid selection' USING ERRCODE='22023'; END IF;
  END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(doc->'boards') LOOP
    IF kind<>'space' AND b->>'id' IS DISTINCT FROM scope->>'boardId' THEN CONTINUE; END IF;
    boards_seen:=boards_seen+1; result_columns:='[]';
    FOR c IN SELECT value FROM jsonb_array_elements(b->'columns') LOOP
      IF kind='column' AND c->>'id' IS DISTINCT FROM scope->>'columnId' THEN CONTINUE; END IF;
      columns_seen:=columns_seen+1; result_items:='[]';
      SELECT array_agg(value->>'id' ORDER BY ordinality) INTO ids
        FROM jsonb_array_elements(c->'items') WITH ORDINALITY;
      i:=0;
      FOR t IN SELECT value FROM jsonb_array_elements(c->'items') LOOP
        i:=i+1; include_item:=kind NOT IN ('item','items') OR t->>'id'=ANY(wanted);
        IF t->>'id'=ANY(wanted) THEN seen:=array_append(seen,t->>'id'); END IF;
        IF NOT include_item AND scope->>'neighbors'='true'
          AND (ids[i-1]=ANY(wanted) OR ids[i+1]=ANY(wanted))
        THEN include_item:=true; near_ids:=near_ids||jsonb_build_array(t->>'id'); END IF;
        IF include_item THEN result_items:=result_items||jsonb_build_array(jsonb_build_object(
          'id',t->>'id','text',t->>'text','done',t->'done','tag','','assignees',t->'assignees'
        )); END IF;
      END LOOP;
      IF kind IN ('item','items') AND jsonb_array_length(result_items)=0 THEN CONTINUE; END IF;
      result_columns:=result_columns||jsonb_build_array(jsonb_build_object(
        'id',c->>'id','title',c->>'title','subtitle',coalesce(c->>'subtitle',''),
        'note',coalesce(c->>'note',''),'icon','auto','items',result_items
      ));
    END LOOP;
    result_boards:=result_boards||jsonb_build_array(jsonb_build_object(
      'id',b->>'id','schemaVersion',1,'title',b->>'title','tagline',coalesce(b->>'tagline',''),
      'footer',coalesce(b->>'footer',''),'typography',jsonb_build_object('headingWeight',800,'bodyWeight',520,'width',100),
      'columns',result_columns
    ));
  END LOOP;
  IF boards_seen=0 OR (kind='column' AND columns_seen=0)
    OR (kind IN ('item','items') AND NOT wanted<@seen)
  THEN RAISE EXCEPTION 'The shared selection no longer exists' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p->>'id','name',p->>'name','email','','avatar','','slackUserId','','slackUrl','')),'[]')
    INTO result_people FROM jsonb_array_elements(doc->'people') p
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(result_boards) rb
      CROSS JOIN LATERAL jsonb_array_elements(rb->'columns') rc
      CROSS JOIN LATERAL jsonb_array_elements(rc->'items') rt
      WHERE (rt->'assignees') ? (p->>'id'));
  RETURN jsonb_build_object('schemaVersion',2,'id','shared','name','Shared pages',
    'people',result_people,'boards',result_boards,'scope',scope,'neighborIds',near_ids,'integrations','{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION prototype_private.project_view(jsonb,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION prototype_api.share_notebook(
  capability text, scope jsonb DEFAULT NULL, revoke_token text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k bytea; doc jsonb; token text; n integer;
BEGIN
  IF capability IS NULL OR capability !~ '^[A-Za-z0-9_-]{43,86}$'
  THEN RAISE EXCEPTION 'Notebook key required' USING ERRCODE='42501'; END IF;
  k:=sha256(convert_to(capability,'UTF8'));
  SELECT document INTO doc FROM prototype_private.notebooks WHERE key_hash=k;
  IF NOT FOUND THEN RAISE EXCEPTION 'Notebook unavailable' USING ERRCODE='42501'; END IF;
  IF revoke_token IS NOT NULL THEN
    UPDATE prototype_private.shares SET revoked=true
      WHERE key_hash=k AND token_hash=sha256(convert_to(revoke_token,'UTF8'));
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n=0 THEN RAISE EXCEPTION 'Link not found' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('revoked',true);
  END IF;
  PERFORM prototype_private.project_view(doc,scope);
  PERFORM pg_advisory_xact_lock(hashtextextended(capability,934));
  IF (SELECT count(*) FROM prototype_private.shares WHERE key_hash=k)>=50
  THEN RAISE EXCEPTION 'Prototype link limit reached' USING ERRCODE='54000'; END IF;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  INSERT INTO prototype_private.shares(token_hash,key_hash,scope)
    VALUES(sha256(convert_to(token,'UTF8')),k,scope);
  RETURN jsonb_build_object('token',token);
END $$;
REVOKE ALL ON FUNCTION prototype_api.share_notebook(text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prototype_api.share_notebook(text,jsonb,text) TO anonymous,authenticated;

CREATE OR REPLACE FUNCTION prototype_api.read_shared(share_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $$
DECLARE s prototype_private.shares; n prototype_private.notebooks;
BEGIN
  IF share_token IS NULL OR share_token !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'Shared link unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM prototype_private.shares
    WHERE token_hash=sha256(convert_to(share_token,'UTF8')) AND NOT revoked;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shared link unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO n FROM prototype_private.notebooks WHERE key_hash=s.key_hash;
  RETURN jsonb_build_object('version',n.version,'value',prototype_private.project_view(n.document,s.scope));
END $$;
REVOKE ALL ON FUNCTION prototype_api.read_shared(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prototype_api.read_shared(text) TO anonymous,authenticated;
NOTIFY pgrst,'reload schema';
