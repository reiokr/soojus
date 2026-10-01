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

### Docker ja kodune server

Repos on `Dockerfile` ja `deploy/docker-compose.yml` (Soojus, Mosquitto, Node-RED, AdGuard). Serveri juurutus Proxmoxiga: [docs/proxmox.md](docs/proxmox.md). Konteineris kuulab server aadressil `HOST` (vaikimisi `127.0.0.1`).

### Töölaua ikoon

`~/Töölaud/soojus.desktop` käivitab `open.sh`, mis vajadusel käivitab
`soojus.service`-i ja avab **http://localhost:3210** vaikebrauseris.
(failid `open.sh` ja vana `run.sh` on selleks otstarbeks olemas)

## Liides

Rakendusel on kaks liidest, mille vahel saab valida: **Klassikaline** (külgriba, kaardid) ja **Uus · Kodu-plaan** (maja lõige, kus näidud on paigutatud seadmete juurde, ja viimase 24 tunni kokkuvõte). Vaheta seadetes (*Seaded ja ühendus → Liides*) või ülemise riba ikooniga; valik salvestub brauserisse. Aadress `?ui=next` või `?ui=classic` valib liidese otse. Mõlemad kasutavad samu andmeid, dialooge ja graafikuid; uus liides on `src/next/` kaustas ja laetakse alles siis, kui see valitakse. Uue liidese värvipalett genereeritakse käsuga `python3 scripts/make-next-palette.py`.

### Elav kodu

Uue liidese menüüs *Veel → Elav kodu* (aadress `?page=live`) on atmosfääriline animeeritud vaade, mida joonistab canvas ilma lisateegita (`src/next/live/`). Taevas, päike ja kuu asuvad Tallinna kohal tegelikus asendis (päikesetõus/-loojang, kuufaas, tähed, langevad tähed), aastaaeg muudab puud, maa värv järgib välistemperatuuri (härmatis, lehed). Akende hõõgus tuleb toatemperatuurist, torudes liiguvad osakesed soojuspumba oleku ja võimsuse järgi, boileris lainetab vedelik ja dušš jookseb, ventilatsiooni õhuvool liigub läbi soojusvaheti värviga välisõhk → tuppa ja toaõhk → välja, ning tolm toas muutub CO₂ taseme järgi. Soojuspump on joonistatud maasoojuspumbana (WZSV 92H3M): ekraani taga pöörleb kompressor (parameeter 70) ja maa sees jookseb alkoholikontuur, kus osakesed liiguvad ainult kompressori töötamise ajal. Seade ei raporteeri alkoholi temperatuure, seepärast need pildil puuduvad. Ilm (pilved, vihm, lumi, udu, äike, tuul ja 7 päeva prognoos) tuleb tasuta teenusest [Open-Meteo](https://open-meteo.com) ilma API-võtmeta; server hoiab vastust 10 minutit vahemälus ja saadab välja ainult umbes 1 km täpsusega koordinaadid. Asukoha (vaikimisi Tallinn) saab valida otsinguga või koordinaatidega lehel *Seaded ja ühendus → Asukoht ja ilm* või pildi all oleva asukohanupuga; see määrab päikese, kuu ja ilma. Kui ilmateenus ei vasta, töötab vaade edasi ilma ilmata (kuni 3 tundi vana andmestikku kasutatakse märkega). Elava kodu lehe all on ilmapaneel: animeeritud ikooniga hetkeilm (tuul ja puhangud, niiskus ja kastepunkt, õhurõhk, pilvisus ja nähtavus, sademed, päikesetõus ja -loojang, UV), 24 tunni prognoos temperatuurijoonega, kokkuvõte külmimast ja soojimast hetkest ning sademete algusest ja 7 päeva prognoos. Demo-nupud (kütmine, tarbevesi, ventilatsioon), ilma valik ja kellaaja liugur muudavad ainult pilti; täisekraan peidab juhtnupud. Pildi all olev *Muusika* nupp lülitab sisse rahuliku taustamuusika (60 sekundit, pausita silmus), kõrvalt saab valida lugu (*Hubane lounge*, *Pehme jazz*, *Õhtune rahu*, *Kitarriõhtu* ja *Pühapäeva hommik*; vahetus toimub sujuva üleminekuga) ja liugur seab helitugevuse; valik jääb brauseris meelde ning heli ei hakka kunagi ise mängima. Lood genereerib `python3 scripts/make-music.py` (numpy, scipy, ffmpeg) kausta `public/audio/`, helid on täielikult sünteesitud, seega autoriõigusi pole. **Oma muusika:** kopeeri helifailid (mp3, ogg, opus, m4a, aac, wav, flac) kataloogi `dist/audio/`, serveri taaskäivitust pole vaja. Rakendus leiab need `GET /api/audio` kaudu ja lisab lugude valikusse (pealkiri tuleb failinimest: `ohtu_kohvi-2.mp3` → *Ohtu kohvi 2*); nimekiri uueneb valiku avamisel ja kõik-järjest režiimis iga loo vahetusel. Failid mängivad pausita silmuses nagu sisseehitatud lood (mp3 puhul võib silmuse kohas kosta lühike vaikus), kogu fail dekodeeritakse mällu, seega eelista kuni mõne minuti pikkuseid lugusid. `npm run build` tühjendab `dist/`, kuid hoiab sinna lisatud failid alles. Dockeri kujutises (`dist/` on kujutise sees) tuleb oma failid mahutada kujutisse või ühendada üksikfailidena (`-v ./minu.mp3:/app/dist/audio/minu.mp3:ro`); kogu `dist/audio` ühendamine peidaks sisseehitatud lood. Arendusrežiimis (`npm run dev`) loetakse kataloogi `public/audio/`. Uue sisseehitatud loo lisamiseks lisa see skripti `SONGS` ja faili `src/next/live/ambience.js` `TRACKS` nimekirja. Vähendatud liikumise eelistus annab ühe staatilise kaadri; tööde ajal peatub joonistamine, kui vaade pole nähtav.

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
- **Airobot ventilatsioon (Modbus TCP, kohtvõrgus):** temperatuurid, niiskus, CO₂, VOC, PM2,5, õhuvool, ventilaatorid, filtri seisund ja veateated. Lisaks on lehel seaded: suvine möödaviik, ventilatsioon sisse/välja, niiskuse/VOC/PM2,5 automaatjuhtimine ja sihttasemed, ülerõhu kiirus ning filtri intervall ja taimeri lähtestus. **Otseandmed pumbalt, myUplink varuks:** kui kohtvõrguliides on ühendatud, tulevad põhinäidud (pealevool, tagasivool, akupaak, välisõhk, tarbevesi ja selle siht, kompressor, impulsid) otse pumbalt iga 10 sekundi järel; ajalukku salvestatakse minutite kaupa. Enne kasutamist kontrollib server, et vähemalt 75% temperatuuridest klapib myUplinki omadega (±3 °C), vastasel juhul jätkatakse myUplinkiga. Kui otseandmed puuduvad või vananevad (üle 3 min), kasutatakse automaatselt myUplinki; kui myUplink ei vasta, jäävad viimane seadmete loend ja näidud alles ning otseandmed kantakse nende peale. Pumba vigade mälu (5 viimast) salvestatakse andmebaasi (`pump_errors`), et muster ei kaoks; Seaded ja ühendus näitab loendit veakoodi eestikeelse nimega, Plaan hoiatab alla 24 h vanuse vea kohta, ja ajalukku salvestatakse diagnostika (imemistemperatuur, kõrg- ja madalrõhk, alkoholi temperatuuride vahe ja selle siht). Hetkevõimsus (kW) loetakse samuti otse, kui server on pumba töötamise ajal kinnitanud, et pumba väli klapib myUplinki "Hetkevõimsusega" (kuni kinnituseni kasutatakse myUplinki). Tööaeg, häired, seaded, tsoonid ja muudatuste tegemine käivad endiselt myUplinki kaudu (otsekirjutamist ei ole).

**Soojuspumba kohtvõrguliides (Alpha Innotec / Luxtronik, ainult lugemine):** myUplinki API ei avalda alkoholi temperatuure, aga pump pakub neid kohtvõrgus pordil 8889. Lehel *Seaded ja ühendus → Soojuspumba kohtvõrguliides* sisestad pumba IP-aadressi; server loeb iga minut alkoholi temperatuuri maast ja maasse ning kuumgaasi, salvestab need andmebaasi (`luxtronik`) ja näitab Küte-lehel, ajaloos ja Elava kodu maakontuuril. Kirjutamiskäske ei kasutata. Protokollil pole autentimist, seega hoia pump ainult kodusesse võrku; server nõustub ainult kohtvõrgu IPv4 aadressiga.
Ajaloo lehel on ventilatsiooni näidud soojuspumba omadega samas valijas: sama ühikuga näitusid (nt pealevool, välisõhk ja sisetemperatuur) saab panna ühele graafikule ning eksportida ühte CSV-faili. Graafik *Toas vs väljas* võrdleb ventilatsiooni väljatõmbeõhku ja soojuspumba välisandurit. Režiimi valik (automaatne + CO₂ piirmäär, manuaalne + kiirus 1–10, õhutus ja ülerõhk + kestus minutites) käib lehel *Ventilatsioon*; sisetemperatuur võetakse ventilatsiooni väljatõmbeõhult, välisõhk soojuspumba andurilt. Seadme ekraanil tuleb sisse lülitada *Menu → Settings → Other → Modbus TCP*, IP sisestatakse lehel *Ventilatsioon*. Näidud salvestatakse samasse andmebaasi (`airobot`). Modbus TCP-l pole autentimist, seega hoia seade ainult kodusesse võrku; server nõustub ainult kohtvõrgu IPv4 aadressiga.
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
