# 🎃 Upiorna Noc Gier

Halloweenowe gry na imprezę – każdy gra na swoim telefonie. Host tworzy pokój, reszta dołącza 5-znakowym kodem (bez logowania).

Adres: https://gry.g-mal.com.pl

## Gry
- **Upiorne UNO** – każdy gracz to osobny kolor z jego twarzą na kartach 1–9, jedyna karta specjalna to +3, opcjonalne „pary” i przebijanie +3.
- **Upiorne Grzybobranie** – rzut kostką i wędrówka nawiedzoną leśną ścieżką do Chatki: grzyby to punkty, muchomor zabiera najlepszego grzyba, a nietoperze, duchy, mgła, dynie i wiedźma mieszają w wyścigu. Wygrywa najpełniejszy koszyk.
- **Dyniowy Refleks** – gra na refleks: po losowej chwili pojawia się dynia i kto dotknie najszybciej, zbiera punkty; ducha dotykać nie wolno, za falstart jest kara.
- **Kto z nas?** – halloweenowe pytania o ekipę; każdy głosuje na kogoś z pokoju, punkty za trafienie w zdanie większości, na koniec tytuły wieczoru.

## Dodawanie gier
Nowa gra to plik w `js/games/`, który woła `registerGame({ id, name, emoji, tagline, min, max, create, action, view, render, … })` – opis interfejsu jest w `js/app.js` (sekcja „Rejestr gier”). Dołącz plik w `index.html` i gra pojawi się w lobby.

Statyczna strona (vanilla HTML/CSS/JS) na GitHub Pages.

## Serwer pokoi
Połączenia idą przez własny serwer na Cloudflare (`server/`, Worker + Durable Object) pod `wss://pokoje.g-mal.com.pl`, a nie przez publiczny serwer PeerJS – bez cudzych limitów i działa też w sieciach blokujących WebRTC. Klient: `js/net.js`.

Wdrożenie: `cd server && npx wrangler deploy`. Test lokalny: `npx wrangler dev --port 8787`, a grę otwórz z `?relay=ws://localhost:8787`.

## gra.g-mal.com.pl
`gra-proxy/` to Worker, który pod gra.g-mal.com.pl podaje grę konkursową „FAKE czy FAKT?” bezpośrednio z fake-czy-fakt-unseen.pl (zamiast przekierowania). Dzięki temu gra działa też w sieciach blokujących nowo zarejestrowane domeny. Wdrożenie: `cd gra-proxy && npx wrangler deploy`.
