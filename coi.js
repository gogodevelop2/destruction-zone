// 교차 출처 격리용 서비스 워커. 작업 스레드와 SharedArrayBuffer 를 쓰려면 페이지가 COOP·COEP 머리글을 받아야 하는데,
// GitHub Pages 는 머리글을 못 바꾼다. 그래서 이 서비스 워커가 같은 출처의 응답마다 그 머리글을 붙인다.
// index.html 이 처음 열릴 때 등록하고 한 번 새로 고친다. (web/serve.ts 는 머리글을 직접 보내므로 로컬에서는 없어도 된다.)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  e.respondWith(fetch(req).then((res) => {
    if (res.status === 0) return res;
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }));
});
