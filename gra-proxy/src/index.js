// ═════════════ gra.g-mal.com.pl → gra konkursowa „FAKE czy FAKT?” ═════════════
// Zamiast przekierowania podajemy grę bezpośrednio z fake-czy-fakt-unseen.pl (GitHub Pages),
// żeby działała też w sieciach, które blokują nowo zarejestrowane domeny.

const ORIGIN = "https://fake-czy-fakt-unseen.pl";

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.protocol === "http:") { url.protocol = "https:"; return Response.redirect(url.toString(), 301); }
    const upstream = await fetch(ORIGIN + url.pathname + url.search, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      redirect: "manual",
      headers: { "Accept-Encoding": req.headers.get("Accept-Encoding") || "gzip" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const headers = new Headers(upstream.headers);
    // Przekierowania GitHuba (np. /pdf → /pdf/) zostają pod naszym adresem.
    const loc = headers.get("Location");
    if (loc) headers.set("Location", loc.replace(/^https?:\/\/(www\.)?fake-czy-fakt-unseen\.pl/, url.origin));
    headers.delete("Strict-Transport-Security");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
