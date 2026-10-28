# 🎃 Upiorna Noc Gier

Halloweenowe gry na imprezę – każdy gra na swoim telefonie. Host tworzy pokój, reszta dołącza 5-znakowym kodem (PeerJS, bez logowania).

Adres: https://gry.g-mal.com.pl

## Gry
- **Upiorne UNO** – każdy gracz to osobny kolor z jego twarzą na kartach 1–9, jedyna karta specjalna to +3, opcjonalne „pary” i przebijanie +3.

## Dodawanie gier
Nowa gra to plik w `js/games/`, który woła `registerGame({ id, name, emoji, tagline, min, max, create, action, view, render, … })` – opis interfejsu jest w `js/app.js` (sekcja „Rejestr gier”). Dołącz plik w `index.html` i gra pojawi się w lobby.

Statyczna strona (vanilla HTML/CSS/JS) na GitHub Pages.
