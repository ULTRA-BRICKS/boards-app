"""Optional local semantic sidecar: uv run server.py. Not required for Cloudflare.
E5 is initialized from XLM-RoBERTa. Model weights download on the first start.
Keep this on loopback; deploy a protected HTTPS service before connecting Vercel.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json, os, secrets, threading
from sentence_transformers import SentenceTransformer
MODEL = os.environ.get('EMBEDDING_MODEL', 'intfloat/multilingual-e5-base')
KEY = os.environ.get('EMBEDDING_API_KEY', '')
encoder = SentenceTransformer(MODEL)
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            if self.path != '/embed':
                self.send_error(404); return
            if KEY and not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + KEY):
                self.send_error(403); return
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 100_000:
                self.send_error(413); return
            data = json.loads(self.rfile.read(size))
            texts = data.get('texts')
            if data.get('model') != MODEL or not isinstance(texts, list) or not 1 <= len(texts) <= 32 or any(not isinstance(t, str) or len(t) > 4000 for t in texts):
                self.send_error(400); return
            mode = data.get('mode', 'document')
            if mode not in ('query', 'document', 'symmetric'):
                self.send_error(400); return
            # E5 retrieval is asymmetric. Duplicate detection is symmetric.
            prefix = 'passage: ' if mode == 'document' else 'query: '
            prepared = [prefix + t for t in texts] if 'e5' in MODEL.lower() else texts
            with lock:
                vectors = encoder.encode(prepared, normalize_embeddings=True, convert_to_numpy=True).tolist()
            out = json.dumps({'model': MODEL, 'dimension': len(vectors[0]), 'vectors': vectors}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(out))); self.end_headers(); self.wfile.write(out)
        except Exception:
            self.send_error(400, 'Invalid embedding request')
    def log_message(self, fmt, *args):
        pass  # Text and API keys must not appear in access logs.
if __name__ == '__main__':
    print(f'Embedding model: {MODEL}; loopback port 8765')
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
