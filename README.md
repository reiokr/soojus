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

Uue liidese menüüs *Veel → Elav kodu* (aadress `?page=live`) on atmosfääriline animeeritud vaade, mida joonistab canvas ilma lisateegita (`src/next/live/`). Sama vaade on lühemalt ka Kodu lehe sees (nupp *Demo ja ilmaprognoos* viib täisvaatesse).

#### Taevas, aastaaeg ja ilm

Taevas, päike ja kuu asuvad valitud asukoha (vaikimisi Tallinn) kohal tegelikus asendis (päikesetõus/-loojang, kuufaas, tähed, langevad tähed); aastaaeg muudab puid ja maa värv järgib välistemperatuuri (härmatis, lehed). Ilm (pilved, vihm, lumi, udu, äike, tuul ja 7 päeva prognoos) tuleb tasuta teenusest [Open-Meteo](https://open-meteo.com) ilma API-võtmeta; server hoiab vastust 10 minutit vahemälus ja saadab välja ainult umbes 1 km täpsusega koordinaadid. Asukoha saab valida otsinguga või koordinaatidega lehel *Seaded ja ühendus → Asukoht ja ilm* või pildi all oleva asukohanupuga; see määrab päikese, kuu ja ilma. Kui ilmateenus ei vasta, töötab vaade edasi ilma ilmata (kuni 3 tundi vana andmestikku kasutatakse märkega). Ilma saab ka ise ette valida ja kellaaja liuguriga aega nihutada (vt *Demo ja täisekraan*).

#### Maja ja seadmed

Akende hõõgus tuleb toatemperatuurist, torudes liiguvad osakesed soojuspumba oleku ja võimsuse järgi, boileris lainetab vedelik ja dušš jookseb, ventilatsiooni õhuvool liigub läbi soojusvaheti värviga välisõhk → tuppa ja toaõhk → välja, ning tolm toas muutub CO₂ taseme järgi. Soojuspump on joonistatud maasoojuspumbana (WZSV 92H3M): ekraani taga pöörleb kompressor (parameeter 70) ja maa sees jookseb soojakandja kontuur, kus osakesed liiguvad ainult kompressori töötamise ajal. Seade ei raporteeri soojakandja temperatuure, seepärast need pildil puuduvad, kuni pumba kohtvõrguliides on ühendatud. Seadmetel saab klõpsata: hõljumisel tõuseb ese esile, selgitav silt näitab hetkeseisu ja nupp viib vastavale lehele (Küte, Tarbevesi või Ventilatsioon).

#### Kass

Elutoas elab kass (`src/next/live/cat.js`): ta magab, istub ja vaatab ringi, ringutab, haigutab, lakub end, liigutab saba või kõrva, keerab end ja kõnnib aeg-ajalt teise kohta. Vahepeal hüppab ta radiaatorile aknast välja vaatama — sealt lendab mööda tihane, öösiti ööliblikas — või läheb diivanile ja teeb seal mitu tegevust, kuni hüppab maha tagasi. Käitumine on juhuslik, kuid kass ei jää kunagi kohtade vahele ega õhku; asukoht ja poos jäävad brauserisse meelde (`soojus.cat`).

#### Muusika ja heliefektid

Pildi all olev *Muusika* nupp lülitab sisse rahuliku taustamuusika. Nupu kõrval on eelmise ja järgmise loo nupp, paus/jätka nupp (lugu jätkub samast kohast; *Muusika* nupp peatab täielikult ja järgmine käivitus algab algusest), esitusrežiimi nupp (ühe loo kordamine või kõik lood järjest), loovalik ja helitugevuse liugur; lugude vahetus toimub sujuva üleminekuga. Muusika seis jääb brauseris meelde (kas muusika oli sees, kas oli pausil, lugu, koht loos, režiim ja helitugevus) ning on kogu rakenduse peale ühine: Kodu ja Elava kodu lehe vahel liikudes muusika ei katke, lehtedel ilma muusikanupata jääb see pausile ja jätkub samast kohast. Lehe uuesti laadimisel jätkub sees olnud muusika varasemast kohast; brauser lubab heli alustada alles pärast esimest klõpsu või klahvivajutust, seni näitab nupp *Klõpsa lehel*. Pausil olnud muusika ei hakka ise mängima.

Kaasas on üks sünteesitud lugu: *Hubane lounge* (60 sekundit, pausita silmus). Lood genereerib `python3 scripts/make-music.py` (numpy, scipy, ffmpeg) kausta `public/audio/`; skriptis on viis lugu (*Hubane lounge*, *Pehme jazz*, *Õhtune rahu*, *Kitarriõhtu* ja *Pühapäeva hommik*), helid on täielikult sünteesitud, seega autoriõigusi pole. Kaasas olevate lugude nimekiri ja URL-id on failis `src/next/live/ambience.js` (`TRACKS`) — uue sisse ehitatud loo lisamiseks lisa see skripti `SONGS` nimekirja, genereeri fail ja lisa kirje `TRACKS`-i.

**Oma muusika:** kopeeri helifailid (mp3, ogg, opus, m4a, aac, wav, flac) kataloogi `dist/audio/`, serveri taaskäivitust pole vaja. Rakendus leiab need `GET /api/audio` kaudu ja lisab lugude valikusse (pealkiri tuleb failinimest: `ohtu_kohvi-2.mp3` → *Ohtu kohvi 2*); nimekiri uueneb valiku avamisel ja kõik-järjest režiimis iga loo vahetusel. Failid mängivad pausita silmuses nagu sisseehitatud lood (mp3 puhul võib silmuse kohas kosta lühike vaikus), kogu fail dekodeeritakse mällu, seega eelista kuni mõne minuti pikkuseid lugusid. `npm run build` tühjendab `dist/`, kuid hoiab sinna lisatud failid alles. Dockeri kujutises (`dist/` on kujutise sees) tuleb oma failid mahutada kujutisse või ühendada üksikfailidena (`-v ./minu.mp3:/app/dist/audio/minu.mp3:ro`); kogu `dist/audio` ühendamine peidaks sisseehitatud lood. Arendusrežiimis (`npm run dev`) loetakse kataloogi `public/audio/`.

Äikese ajal käib iga välgulöögiga kaasas äikesehelin, mis mängib ainult siis, kui taustamuusika parasjagu käib (heliefekt `public/sfx/lightning.mp3`, kärbitud Pixabayi tasuta helist „Lightning Storm"); vihma ajal mängib katkematu vihmaheli, mis tuleb vaikselt sisse ja hajub välja, kui sadu lõpeb (`public/sfx/rain.mp3`).

#### Demo ja täisekraan

Demo-nupud (päris andmed, kütmine, tarbevee laadimine, ventilatsioon, kõik korraga), ilma valik ja kellaaja liugur muudavad ainult pilti, mitte seadmeid. Täisekraan peidab juhtnupud ja maakontuuri soojakandja temperatuurisildid, kuid ülaservast saab hiireliigutusel otse lehtedele Küte, Tarbevesi ja Ventilatsioon liikuda; paremas servas on infobulletid (Toas, Väljas, Tarbevesi) ja nende all alati nähtav kompaktne ilmaplokk: hetkeilm animeeritud ikooniga ning lühike tekstiline 24 tunni kokkuvõte (kõrgeim, madalaim ja sademete algus).

#### Ilmapaneel

Elava kodu lehe all on ilmapaneel: animeeritud ikooniga hetkeilm (tuul ja puhangud, niiskus ja kastepunkt, õhurõhk, pilvisus ja nähtavus, sademed, päikesetõus ja -loojang, UV), 24 tunni prognoos temperatuurijoonega, kokkuvõte külmimast ja soojimast hetkest ning sademete algusest ja 7 päeva prognoos.

#### Jõudlus ja ligipääsetavus

Vähendatud liikumise eelistus annab ühe staatilise kaadri; tööde ajal peatub joonistamine, kui vaade pole nähtav.

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
- **Airobot ventilatsioon (Modbus TCP, kohtvõrgus):** temperatuurid, niiskus, CO₂, VOC, PM2,5, õhuvool, ventilaatorid, filtri seisund ja veateated. Lisaks on lehel seaded: suvine möödaviik, ventilatsioon sisse/välja, niiskuse/VOC/PM2,5 automaatjuhtimine ja sihttasemed, ülerõhu kiirus ning filtri intervall ja taimeri lähtestus. Õhuvoolu registrid (1051/1052) edastab Airobot reaalselt ainult konstantse õhuvooluga ("constant-flow") mudelitel; antud seadmel jääb register kinni staatilisse väärtusesse (100 m³/h ka siis, kui ventilaatorid käivad ~3000 p/min), seepärast hindab rakendus õhuvoolu ventilaatori tasemest tootja ametliku S2 kõvera järgi (MIN 90 m³/h, 30% 166, 70% 324, 100% 463; tase 1 → 90, tase 5 → 245, tase 10 → 463 m³/h; märgitud liideses „hinnanguline"). Püsiva voolu (constant flow) režiimi sisselülitamine äpi paigaldajarežiimis registrit elavaks ei muutnud ja põhjustas sissepuhkeventilaatori vea; seade taastati taaskäivitusega ja püsiv vool jäetakse välja, kuni paigaldaja selle nõuetekohaselt seadistab. Suvise möödaviigu lüliti on **automaatrežiim** (klapp avaneb ise, kui välisõhk on üle 13 °C ja jahedam kui väljatõmbeõhk); klapi tegelik asend (avatud/suletud) tuletatakse nendest tingimustest ja soojustagastuse näidust, sest Modbus seda otseselt ei edasta. **Otseandmed pumbalt, myUplink varuks:** kui kohtvõrguliides on ühendatud, tulevad põhinäidud (pealevool, tagasivool, akupaak, välisõhk, tarbevesi ja selle siht, kompressor, impulsid) otse pumbalt iga 10 sekundi järel; ajalukku salvestatakse minutite kaupa. Enne kasutamist kontrollib server, et vähemalt 75% temperatuuridest klapib myUplinki omadega (±3 °C), vastasel juhul jätkatakse myUplinkiga. Kui otseandmed puuduvad või vananevad (üle 3 min), kasutatakse automaatselt myUplinki; kui myUplink ei vasta, jäävad viimane seadmete loend ja näidud alles ning otseandmed kantakse nende peale. Pumba vigade mälu (5 viimast) salvestatakse andmebaasi (`pump_errors`), et muster ei kaoks; Seaded ja ühendus näitab loendit veakoodi eestikeelse nimega, Kodu leht hoiatab alla 24 h vanuse vea kohta, ja ajalukku salvestatakse diagnostika (imemistemperatuur, kõrg- ja madalrõhk, soojakandja temperatuuride vahe ja selle siht). Soojusvõimsus (kW) loetakse samuti otse, kui server on pumba töötamise ajal kinnitanud, et pumba väli klapib myUplinki „Hetkevõimsusega“; see myUplinki punkt (21) on tegelikult soojusvõimsus ja kattub pumba `power_heat` näiduga. Elektrivõimsus (`power_ac`) tuleb samuti kohalikust liidesest ja seda kasutab energiaaruanne COP-i ning kulu arvutamiseks. Tööaeg, häired, seaded, tsoonid ja muudatuste tegemine käivad endiselt myUplinki kaudu (otsekirjutamist ei ole).

**Soojuspumba kohtvõrguliides (Alpha Innotec / Luxtronik, ainult lugemine):** myUplinki API ei avalda soojakandja temperatuure, aga pump pakub neid kohtvõrgus pordil 8889. Lehel *Seaded ja ühendus → Soojuspumba kohtvõrguliides* sisestad pumba IP-aadressi; server loeb iga minut soojakandja temperatuuri maast ja maasse ning kuumgaasi, salvestab need andmebaasi (`luxtronik`) ja näitab Küte-lehel, ajaloos ja Elava kodu maakontuuril. Kirjutamiskäske ei kasutata. Protokollil pole autentimist, seega hoia pump ainult kodusesse võrku; server nõustub ainult kohtvõrgu IPv4 aadressiga.
Ajaloo lehel on ventilatsiooni näidud soojuspumba omadega samas valijas: sama ühikuga näitusid (nt pealevool, välisõhk ja sisetemperatuur) saab panna ühele graafikule ning eksportida ühte CSV-faili. Graafik *Toas vs väljas* võrdleb ventilatsiooni väljatõmbeõhku ja soojuspumba välisandurit. Režiimi valik (automaatne + CO₂ piirmäär, manuaalne + kiirus 1–10, õhutus ja ülerõhk + kestus minutites) käib lehel *Ventilatsioon*; sisetemperatuur võetakse ventilatsiooni väljatõmbeõhult, välisõhk soojuspumba andurilt. Seadme ekraanil tuleb sisse lülitada *Menu → Settings → Other → Modbus TCP*, IP sisestatakse lehel *Ventilatsioon*. Näidud salvestatakse samasse andmebaasi (`airobot`). Modbus TCP-l pole autentimist, seega hoia seade ainult kodusesse võrku; server nõustub ainult kohtvõrgu IPv4 aadressiga.
- **Elav kodu:** animeeritud majavaade kassiga, taustamuusika (ka omad helifailid) ja äikese-/vihmahelid — vaata osa *Elav kodu*.
- Ilm ja asukoht Open-Meteost (ilmapaneel, 24 h ja 7 päeva prognoos) ilma API-võtmeta.
- Kohalik mõõtmisajalugu: eri perioodid, kuni viis sama ühikuga graafikuseeriat, CSV eksport.
- **Energia ja kulu** (uus liides: *Veel → Energia*): soojus- ja elektrivõimsuse ööpäevane integraal pumba kohalikust liidesest, COP, elektrihinna järgi arvutatud kulu ning CSV eksport (7/30/90/365 päeva). Valida saab ühe- või kahetariifse paketi, sisestada päeva- ja ööhinnad ning öise aja (kohalik kell); kulu arvutatakse elektri tunnijaotuse järgi. Ilma kohaliku liideseta näidatakse ainult soojusvõimsust.
- Püsivara versioonid ja fail, tellimused, seadme võimekused, abirežiimi olek.
- Serveripoolne sisendite ja skaleerimise kontroll; muudatuste audit; osaliste vigade käsitlus.
- Mobiilivaade, klaviatuuriga kasutatavad dialoogid, reduced-motion tugi, kohalikud fondid.
- Hele ja tume teema ühe klõpsuga; valik salvestub ja esmakordsel avamisel järgitakse seadme eelistust.

## Andmed

Andmebaas: `data/soojus.sqlite`. Tokenid ja ühendusinfo on selles serveripoolses andmebaasis. Failid on piiratud kasutaja õigustega ning `.gitignore` välistab `.env` ja kogu `data/` kausta. Varundades käsitle neid privaatsena.

Kogumine toimub kord minutis, ka siis kui brauser on kinni. **Server peab töötama.** Mõõtmised deduplikeeritakse seadme ajatempliga. Säilitamine 10 aastat; vanemad kui 45 päeva andmed koondatakse päevakeskmisteks, et päringud püsiksid kiired. Liidesest saab valida kuupäeva, millest vanemad andmed arhiveeritakse eraldi CSV-faili (`data/archive/`) ja eemaldatakse aktiivsest andmebaasist; arhiveerida ei saa andmeid, mis on uuemad kui 365 päeva. Arhiveeritud faile saab ajaloo lehe **„Arhiiv"** vahekaardil graafikuna vaadata (ainult lugemine, andmeid ei impordita tagasi). Ajalugu algab rakenduse ühendamisest. Graafikul kasutatakse perioodile vastavalt 1 minuti, 10 minuti, tunni või päeva keskmisi; CSV eksport sisaldab kõiki perioodi salvestatud algandmeid. Energiaaruanne arvutab soojuse ja elektri võimsusnäitude ajalisest integraalist; mõõtmispauside korral võib tulemus olla veidi alahinnatud.

Avalik API ei paku kõiki myUplinki enda veebilehe funktsioone. Ajagraafikud pole selle seadme API-s toetatud; häirete lähtestamine ja püsivara paigaldamine toimuvad ametlikus portaalis või seadmel. Täpsem API-funktsioonide ülevaade: [docs/API.md](docs/API.md).

## Kontrollimine

```sh
npm test                 # ühikutestid (sõnastikud, loogika, server)
npm run build            # tootmisbuild
npm run test:e2e         # Playwrighti täistestid (vajab töötavat rakendust ja seadet)
npm run test:e2e:smoke   # suitsutestid (töötavad ka seadme ja kontota; CI-s)
```

Brauseritestid kasutavad käivat serverit aadressil `http://localhost:3210` (muudetav `E2E_BASE_URL`-iga). Kui server juba töötab, kasutatakse seda; muidu käivitab Playwright `npm start` (eelnevalt `npm run build`). Esmakordselt installi brauser: `npx playwright install chromium`.

Täistestid sõltuvad päris soojuspumbast ja myUplinki kontost. Suitsutestid (`e2e/smoke.spec.js`) kontrollivad keelevahetust ja mõlema liidese laadimist ka tühja andmebaasiga. Kirjutamise töövoogu kontrollitakse mock-vastusega, füüsilise soojuspumba seadistusi testide käigus ei muudeta.

GitHub Actions (`.github/workflows/ci.yml`) jooksutab iga pushi ja pull requesti peale ühikutestid, buildi ja suitsutestid. Täistestid jäävad kohalikuks.

**Kodu lehe teated.** Kodu lehel saab iga teate peita nupuga *Peida*; peidetud teade kaob lehelt täielikult ja jääb brauseris meelde (`localStorage`), kuni selle sisu oluliselt muutub. Peidetud teateid näeb ja saab tagasi tuua lehel *Veel → Teavitused*, jaotises *Kodu lehe teated*.
