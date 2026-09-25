# Soojus · kodu juhtimiskeskus

Eestikeelne Reacti veebirakendus myUplinkiga ühendatud soojuspumba jälgimiseks ja juhtimiseks. Kohandatud WZSV 92H3M tegelike näitude ja võimaluste järgi.

## Käivitamine

Vajalik Node.js 22.13+ (soovituslik 24 või uuem).

```sh
npm install
npm run build
npm start
```

Ava **http://localhost:3210**. Arenduses `npm run dev`. Server kuulab kohalikul aadressil 127.0.0.1; rakendus on ühe kasutaja kohalik juhtimiskeskus. Avalikku internetti viimiseks on vaja eraldi kasutaja autentimist ja HTTPS pöördproksit.

### Püstine server (systemd user-teenus)

Andmete kogumine toimub ka siis, kui brauser on kinni, seega server jookseb
systemd user-teenusena `soojus.service`:

```sh
systemctl --user status soojus.service
systemctl --user restart soojus.service
journalctl --user -u soojus.service -f
```

Teenus on lubatud (`enable`) ja taaskäivitub vea korral. Kasutajal on
`Linger=yes`, seega jääb server tööle ka väljalogimisel.

### Töölaua ikoon

`~/Töölaud/soojus.desktop` käivitab `open.sh`, mis vajadusel käivitab
`soojus.service`-i ja avab **http://localhost:3210** vaikebrauseris.
(failid `open.sh` ja vana `run.sh` on selleks otstarbeks olemas)

## Ühendus

Selles installis on myUplink API-rakendus kasutaja loal registreeritud ja võtmed `.env` failis. Server hoiab neid brauserist eemal. Uue installi jaoks kopeeri `.env.example` → `.env` ning lisa Client Identifier ja Client Secret, või kasuta rakenduse **Seaded ja ühendus** vormi.

myUplinki registreerimisel Callback URL: `http://localhost:3210/auth/callback`. Oma konto jaoks kasutatakse client credentials voogu; saadaval on ka authorization code voog ja refresh-tokenite vahetamine.

## Võimalused

- Pärisandmetega ülevaade, kütteskeem, ühenduse ja andmete vanuse näit.
- Kütteskeemil animatsioon: kütmise ajal liigub ringis vooluhulk ja küttekeha hõõgub, tarbevee kütmisel liigub vesi ja boileris tõusevad mullid, seisu näitab tekst.
- Kütte temperatuuri nihe, kütte töörežiim ja välisõhupiir.
- Tarbevee siht, töörežiim, kiirlaadimine, kõrgendatud tarbevesi ja kestus.
- Kõik API parameetrid koos otsingu, kategooriate, muutmisõiguse ja lemmikutega.
- Tsoonide sihtväärtused ja toetatud töörežiimid.
- Kodurežiimid nende seadmete jaoks, mis neid toetavad.
- Aktiivsed häired, ajalugu ja leheküljed.
- Kohalik mõõtmisajalugu: eri perioodid, kuni viis sama ühikuga graafikuseeriat, CSV eksport.
- Püsivara versioonid ja fail, tellimused, seadme võimekused, abirežiimi olek.
- Serveripoolne sisendite ja skaleerimise kontroll; muudatuste audit; osaliste vigade käsitlus.
- Mobiilivaade, klaviatuuriga kasutatavad dialoogid, reduced-motion tugi, kohalikud fondid.
- Hele ja tume teema ühe klõpsuga; valik salvestub ja esmakordsel avamisel järgitakse seadme eelistust.

## Andmed

Andmebaas: `data/soojus.sqlite`. Tokenid ja ühendusinfo on selles serveripoolses andmebaasis. Failid on piiratud kasutaja õigustega ning `.gitignore` välistab `.env` ja kogu `data/` kausta. Varundades käsitle neid privaatsena.

Kogumine toimub kord minutis, ka siis kui brauser on kinni. **Server peab töötama.** Mõõtmised deduplikeeritakse seadme ajatempliga. Säilitamine 365 päeva. Ajalugu algab rakenduse ühendamisest. Graafikul kasutatakse perioodile vastavalt 1 minuti, 10 minuti, tunni või päeva keskmisi; CSV eksport sisaldab kõiki perioodi salvestatud algandmeid. Puuduvat energiakulu ei arvutata oletuslikult hetkevõimsusest.

Avalik API ei paku kõiki myUplinki enda veebilehe funktsioone. Ajagraafikud pole selle seadme API-s toetatud; häirete lähtestamine ja püsivara paigaldamine toimuvad ametlikus portaalis või seadmel. Täpsem API-funktsioonide ülevaade: [docs/API.md](docs/API.md).

## Kontrollimine

```sh
npm test
npm run build
npx playwright test
```

Brauseritestid kasutavad käivat serverit aadressil localhost:3210. Kirjutamise töövoogu kontrollitakse mock-vastusega, füüsilise soojuspumba seadistusi testide käigus ei muudeta.
