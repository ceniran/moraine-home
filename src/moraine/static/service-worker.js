const CACHE="moraine-beta-v10-tiering";
const ASSETS=["./","./index.html","./styles.css","./components.css","./connection-guide.css","./app.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener("fetch",event=>{const path=new URL(event.request.url).pathname;if(event.request.method!=="GET"||path.startsWith("/api/")||path.startsWith("/moraine-beta/api/"))return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request))) });
