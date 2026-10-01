# myUplink API märkmed

Dokumentatsioon uuritud 24.09.2026 Floorp MCP abil:
- https://dev.myuplink.com/documentation/intro?activeTab=quick-start-guide
- https://dev.myuplink.com/documentation/auth?activeTab=client-auth
- https://dev.myuplink.com/documentation/parameters?activeTab=parameters
- https://dev.myuplink.com/documentation/parameters?activeTab=settings
- https://api.myuplink.com/swagger/index.html
- https://api.myuplink.com/swagger/docs/public-v2/swagger.json

## Rakendatud avalikud funktsioonid

| Funktsioon | API |
|---|---|
| Süsteemide ja seadmete valik, lehekülgede läbimine | GET /v2/systems/me |
| Seadme info ja ühendus | GET /v2/devices/{deviceId} |
| Kõik näidud, metaandmed, kirjutusõigus, lubatud valikud | GET /v2/devices/{deviceId}/points |
| Üksiku parameetri muutmine; server toetab ka kuni 20 parameetri partiid | PATCH /v2/devices/{deviceId}/points |
| Võimekused | GET /v2/devices/{deviceId}/smart-home-categories |
| Tsoonid ja nende seadistamine | GET /v2/devices/{deviceId}/smart-home-zones; PATCH /v2/devices/{deviceId}/zones/{zoneId} |
| Kodurežiimid (kui toetatud) | GET/PUT /v2/systems/{systemId}/smart-home-mode |
| Aktiivsed ja varasemad häired, leheküljed | GET /v2/systems/{systemId}/notifications[/active] |
| Püsivara info ja allalaadimine | GET /v2/devices/{deviceId}/firmware-info; GET /v2/firmware/{firmwareTypeId}/version/{version}/download |
| Abirežiimi lugemine | GET /v2/devices/{deviceId}/aidMode |
| Premium | GET /v2/systems/{systemId}/subscriptions |
| Ühenduse kontroll | GET /v2/protected-ping |
| Oma konto autentimine | POST /oauth/token, client_credentials |
| Kasutaja nõusolek, ühekordne state, tokenite uuendamine | GET /oauth/authorize; POST /oauth/token |

Swaggeri tühjade objektidena avaldatud ajaloo-, taaskäivitamise-, häirete lähtestamise- ja sisemisi meetodeid ei kutsuta. Rakendus kogub ise SQLite ajaloo; ei fabritseeri puuduvat varasemat ajalugu ega energiakulu. Püsivara paigaldamine ja häirete lähtestamine avatakse myUplinki ametlikus vaates.

## WZSV 92H3M eripärad

Kontol tuvastatud seade väljastab 56 parameetrit, 12 neist muudetavad; täpne arv sõltub seadme vastusest. Kategoorianimed võivad olla `Text not found`. Selles mudelis on osa smartHomeCategories väärtusi semantiliselt eksitavad: tarbevee temperatuur on ühtlasi `sh-indoorTemp`. Seetõttu ei kasutata seda toa temperatuurina. Mudelile on antud kontrollitud ID-põhised esitlusnimed; teised seadmed kasutavad API metaandmeid.

**Skaleerimine:** v2 GET `value` on juba kasutajaühikutes. `minValue`, `maxValue`, `stepValue` tuleb korrutada `scaleValue`-ga. Näiteks tarbevee piirid 300–650 ja samm 5, scale 0.1 tähendab 30–65 °C, samm 0.5 °C. PATCH väärtus on kasutajaühikutes (45.5), mitte 455. Seda käitumist kinnitab Home Assistanti myuplink/number.py. Tsoonide piirid ja sihtväärtused on juba kasutajaühikutes. Server valideerib kirjutamist päris seadme värskelt loetud metaandmetega.

`PATCH points` võib tagastada osalise tulemuse (207). Iga parameetri vastus peab olema `modified`; puuduvaid/veaga tulemusi ei esitata õnnestumisena. Isegi kinnitatud käsk võib füüsilisele seadmele jõuda viivitusega. Kasutajaliides ei asenda mõõdetud väärtusi optimistlike väljamõeldud väärtustega.

Kuumaveetsooni sihtväärtuse jaoks on olemas eraldi tsooni muutmise dialoog, mis kasutab /zones meetodit. Mõne tootja tsooni siht ei rakendu üldise /points meetodi kaudu (jaroschek/home-assistant-myuplink #222).

## GET /api/audio

Elav kodu taustamuusika failid: `{ files: [{ name, url, size }] }`. Loetakse kataloogist `dist/audio` (tootmisrežiim) või `public/audio` (arendus); ainult tavalised helifailid (mp3, ogg, oga, opus, m4a, aac, wav, flac, webm), peidetud failid ja alamkaustad jäetakse välja. Järjestus on tähestikuline.
