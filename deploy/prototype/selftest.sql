-- Run as the database owner in boards_prototype, never in the original database.
-- All fixtures are rolled back inside a subtransaction. No real notebook is deleted.
DO $$
DECLARE
 doc jsonb:='{"schemaVersion":2,"id":"demo","name":"PRIVATE SPACE","people":[{"id":"p","name":"Person","email":"private@example.test","avatar":"","slackUserId":""}],"boards":[{"id":"b","title":"Board","columns":[{"id":"c","title":"Column","items":[{"id":"t1","text":"Проверка 🙂","done":false,"tag":"","assignees":["p"]},{"id":"t2","text":"Neighbor","done":false,"tag":"","assignees":[]}]}]}]}';
 k text:=repeat('A',43); other text:=repeat('B',43); r jsonb; s text; n integer:=0; before_count bigint;
BEGIN
 SELECT count(*) INTO before_count FROM prototype_private.notebooks;
 BEGIN
  PERFORM prototype_api.notebook(k,0,doc); n:=n+1;
  r:=prototype_api.notebook(k);
  ASSERT r->>'version'='1';
  ASSERT r->'value'->'boards'->0->'columns'->0->'items'->0->>'text'='Проверка 🙂'; n:=n+2;
  BEGIN PERFORM prototype_api.notebook(other); RAISE EXCEPTION 'Foreign capability was accepted';
   EXCEPTION WHEN SQLSTATE 'P0002' THEN n:=n+1; END;
  BEGIN PERFORM prototype_api.notebook(k,0,doc); RAISE EXCEPTION 'Existing key overwritten';
   EXCEPTION WHEN SQLSTATE '40001' THEN n:=n+1; END;
  BEGIN PERFORM prototype_api.notebook(k,99,doc); RAISE EXCEPTION 'Stale version accepted';
   EXCEPTION WHEN SQLSTATE '40001' THEN n:=n+1; END;
  BEGIN PERFORM prototype_api.notebook('short'); RAISE EXCEPTION 'Short key accepted';
   EXCEPTION WHEN SQLSTATE '42501' THEN n:=n+1; END;
  BEGIN PERFORM prototype_private.validate_document(doc-'schemaVersion'); RAISE EXCEPTION 'Missing schema accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN n:=n+1; END;
  BEGIN PERFORM prototype_private.validate_document(jsonb_set(doc,'{boards,0,columns,0,items,0,assignees}','[null]')); RAISE EXCEPTION 'Null assignee accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN n:=n+1; END;
  BEGIN PERFORM prototype_private.validate_document(jsonb_set(doc,'{boards,0,columns,0,items,0,text}',to_jsonb(repeat('x',1001)))); RAISE EXCEPTION 'Oversized task accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN n:=n+1; END;
  BEGIN PERFORM prototype_private.project_view(doc,'{"kind":"items","boardId":"b","itemIds":[]}'); RAISE EXCEPTION 'Empty selection accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN n:=n+1; END;
  BEGIN PERFORM prototype_private.project_view(doc,'{"kind":"item","boardId":"b","itemIds":["missing"]}'); RAISE EXCEPTION 'Missing selection accepted';
   EXCEPTION WHEN SQLSTATE 'P0002' THEN n:=n+1; END;
  r:=prototype_api.share_notebook(k,'{"kind":"item","boardId":"b","itemIds":["t1"],"neighbors":false}'); s:=r->>'token';
  r:=prototype_api.read_shared(s);
  ASSERT r::text NOT LIKE '%private@example.test%';
  ASSERT r::text NOT LIKE '%PRIVATE SPACE%';
  ASSERT r::text NOT LIKE '%Neighbor%'; n:=n+3;
  doc:=jsonb_set(doc,'{boards,0,columns,0,items,0,text}','"Current text"');
  PERFORM prototype_api.notebook(k,1,doc); r:=prototype_api.read_shared(s);
  ASSERT r->'value'->'boards'->0->'columns'->0->'items'->0->>'text'='Current text'; n:=n+1;
  BEGIN PERFORM prototype_api.share_notebook(other,NULL,s); RAISE EXCEPTION 'Foreign owner revoked share';
   EXCEPTION WHEN SQLSTATE '42501' THEN n:=n+1; END;
  PERFORM prototype_api.share_notebook(k,NULL,s);
  BEGIN PERFORM prototype_api.read_shared(s); RAISE EXCEPTION 'Revoked link accepted';
   EXCEPTION WHEN SQLSTATE '42501' THEN n:=n+1; END;
  ASSERT NOT has_table_privilege('anonymous','prototype_private.notebooks','SELECT');
  ASSERT NOT has_table_privilege('anonymous','prototype_private.notebooks','UPDATE');
  ASSERT NOT has_schema_privilege('anonymous','prototype_private','USAGE'); n:=n+3;
  RAISE EXCEPTION USING ERRCODE='P7777', MESSAGE='rollback test fixtures';
 EXCEPTION WHEN SQLSTATE 'P7777' THEN NULL;
 END;
 ASSERT (SELECT count(*) FROM prototype_private.notebooks)=before_count; n:=n+1;
 ASSERT n=22;
 RAISE NOTICE '22 adversarial PostgreSQL checks passed; all test writes rolled back.';
END $$;
