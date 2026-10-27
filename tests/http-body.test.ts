import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedText } from '../server/lib/http-body';

test('a chunked request is cancelled at the byte limit instead of reading its remainder', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  const request = new Request('https://crosslab.test/', { method: 'POST', body, duplex: 'half' } as RequestInit);
  assert.equal(request.headers.has('Content-Length'), false);
  assert.equal(await readBoundedText(request, 2048), null);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4, 'only bounded chunks were requested');
});

test('body limits count UTF-8 bytes and preserve a complete multibyte boundary', async () => {
  const exact = new Request('https://crosslab.test/', { method: 'POST', body: '中文' });
  assert.equal(await readBoundedText(exact, 6), '中文');
  const tooLarge = new Request('https://crosslab.test/', { method: 'POST', body: '中文' });
  assert.equal(await readBoundedText(tooLarge, 5), null);
});

