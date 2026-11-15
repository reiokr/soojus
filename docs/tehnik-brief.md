# Luxtronik / Alpha Innotec WZSV 92H3M — tehniku brief

**Kuupäev:** 15.11.2026  
**Objekt:** eramaja, maasoojuspump Alpha Innotec WZSV 92H3M, Luxtronik 2.x, püsivara V3.92.3  
**Koostas:** Soojuse rakenduse andmete põhjal

## 1. Hüdraulika

- Galmeti akupaak soojuspumba ja kütteringi vahel.
- Akupaagil **2 ühendust soojuspumbaga** (primaarne) ja **2 ühendust kütteringiga** (sekundaarne) + täitmine.
- Kütteringil **eraldi pump**, kollektor koos mootoritega ja iga ringi ruumitermostaat.
- See on **paralleelne akupaak / hüdrauliline eraldaja** (`Trennsp` / Trennspeicher), mitte jadapaak (`Rückl` / Reihenspeicher).

## 2. Praegused Luxtronik 3003 seaded (15.11.2026)

| ID | Parameeter | Väärtus | Märkus |
|---|---|---|---|
| 35 | `ID_Einst_HREinb_akt` — Einbindung | **1 (Trennsp)** | Muudetud 15.11.2026 17:08; menüüs peidetud, kirjutatud otse 3002-ga |
| 116 | `ID_Einst_AnlPrio_Hzakt` — prioriteet küte | 2 | OK |
| 117 | `ID_Einst_AnlPrio_Bwakt` — prioriteet tarbevesi | 1 | OK |
| 118 | `ID_Einst_AnlPrio_Swakt` — prioriteet bassein | 3 | OK |
| 42 | `ID_Einst_MK1Typ_akt` — Mischkreis 1 | 0 (seguventiili pole) | Kontrollida skeemi järgi |
| 40 | `ID_Einst_BWBer_akt` — BWBer | 1 | Kontroller muutis automaatselt 0 → 1 koos `Trennsp`-iga |
| 83 | `ID_Einst_ZUPTYP_akt` — Warmw. 3 | 0 (mit ZUP) | Sobib paralleelsele paagile |
| 148 | `ID_Einst_BwHup_akt` — Warmw. 5 | 1 (mit HUP) | Kontroller muutis automaatselt 0 → 1; `Warmw. 5` on menüüs peidetud |
| 977 | `ID_Einst_Multispeicher_akt` | 0 (väljas) | Teist salvestit ei kasutata |
| 105 | `ID_Soll_BWS_akt` — tarbevee siht | 48 °C | |
| 74 | `ID_Einst_BWS_Hyst_akt` — tarbevee hüsterees | 2,0 K | |
| 149 | `ID_Einst_TVLmax_akt` — max pealevool | 64,0 °C | |
| 973 | `ID_Einst_BW_max` — max tarbevesi | 65,0 °C | |

Väline tagasivooluandur `TRL_ext` on olemas (äpp näitab „Akupaak“).

Kontrollitud 15.11.2026: `Warmw. 1` / „Tarbeveeboiler1“ = **Andur** (Fühler), seega DHW anduri režiim on korrektne. `BWBer = 1` ei muutnud seda termostaadiks.

## 3. Käitumine enne ja pärast 23.10.2026

Tehnik käis 23.10.2026 (app'i ajalugu näitab 09:04 küte/tarbevesi välja, 10:38 tagasi automaatikale). Kohalikud 3003 muudatused ei ole app'i logis, aga käitumine muutus:

| Välisõhk 8–10 °C | Enne 23.10 | Pärast 23.10 |
|---|---|---|
| Pealevool / tagasivool | 31,7 / 30,0 °C | 34,8 / 34,3 °C |
| Akupaak (`TRL_ext`) | 27,2 °C | 27,9 °C |
| Akupaak − tagasivool | −2,8 K | −6,4 K |
| Tagasivoolu siht | 27,9 °C | 27,2 °C |

Pärast 23.10 on tagasivoolu siht **madalam**, aga tegelik tagasivool **4,3 K kõrgem** ja akupaak jääb 6 K jahedamaks. See sobib olukorraga, kus pump kütab kütteringi otse ja akupaaki ei laeta — st `Einbindung` on jadamisi (`Rückl`), kuigi hüdraulika on paralleelne (`Trennsp`).

## 4. Viga 765 — 04.11.2026 kell 09:17 (kohalik)

- 07:13–07:18 UTC: imemistemperatuur 12,2 → 1,9 → 1,5 → 3,0 → 4,9 → **−2,6 °C**.
- Kõrgrõhk 21,8 → **22,5 bar**, kuumgaas 81–82 °C.
- Soojakandja vahe 3,8–3,9 K, siht 4,2 K (veidi madal).
- 07:18 kompressor seiskus, rõhud ühtlustusid, imemistemperatuur tõusis 11,4 → 34,6 °C.

See on **külmaaine/EEV (paisuventiili) probleem**, mitte akupaagi seade. Filtrid vähendasid 765 sagedust (enne peaaegu iga nädal, pärast üks 04.11), aga juurpõhjus võib alles olla. Kui 765 kordub tihti, tuleb kontrollida EEV-d ja külmaaine täitmist — selleks sobib kohalik külmatehnik, mitte tingimata Alpha Innotec 200 km kaugusel.

## 5. Kuidas muuta `Einbindung` (eestikeelne menüü)

**Sellel pumbal oli `Einbindung` menüüs peidetud** (`ID_Visi_SysEin_Einbindung = 0`), seetõttu kirjutati parameeter 35 otse Luxtroniku 3002 käsuga 15.11.2026 17:08. Allpool on menüütee juhuks, kui see on nähtav.

Sõnastus võib pumbal veidi erineda; oluline on jõuda `Einbindung` valikuni ja valida `Trennsp` (eralduspaak), mitte `Rückl` (jadapaak).

1. Vajuta pumbal `Menüü` (või hoia nuppu all, kuni avaneb peamenüü).
2. Vali **`Teenindus`** (Service). Kui küsitakse koodi, sisesta paigaldaja kood.
3. Vali **`Süsteemi seadistus`** (System Einstellung).
4. Vali **`Ühendus`** / **`Hüdrauliline ühendus`** (Einbindung).
5. Vali **`Eralduspaak`** / **`Paralleelpaak`** (Trennsp), mitte `Tagasivool` / `Jadapaak` (Rückl).
6. Vajuta **`Salvesta`** / **`Kinnita`** (Einstellungen speichern).
7. Välju **`Tagasi`** (Zurück) või **`Avaleht`** (Start).
8. Jälgi 24 h: akupaagi temperatuur peaks liikuma tagasivoolu sihi poole. Kui mitte, vali tagasi `Rückl`.

## 6. Soovitatud tegevus

1. **`Einbindung = Trennsp` on nüüd seatud** (parameeter 35 = 1, 15.11.2026 17:08). Menüüs oli see peidetud, seetõttu kirjutati otse 3002-ga.
2. Kontrollida, et `TRL_ext` andur on akupaagis õiges kohas (keskmine/alumine).
3. Kontrollida `Warmw. 1 = Andur` (15.11.2026 kontrollitud), `Warmw. 3 = mit ZUP`, `Warmw. 5 = mit HUP` (kontroller muutis automaatselt), `Mischkr1 = Nein`, `Multispeicher = Nein`.
4. Jälgida 24–48 h:
   - akupaagi temperatuur peaks liikuma tagasivoolu sihi poole;
   - pealevool/tagasivool ei tohiks olla 5+ K üle sihi;
   - pump võib laadida paaki suurema võimsusega ja siis pausida.
5. Jälgida **järgmist tarbevee tsüklit**: kas HUP töötab DHW ajal ja kas tarbevesi kütab 48 °C-ni. Kui DHW ei küta või küte läheb DHW ajal liiga soojaks, pöörata `Einbindung` tagasi `Rückl` ja vajadusel `BwHup`/`BWBer` algväärtustele.
6. Kui käitumine halveneb, pöörata `Einbindung` tagasi `Rückl` (parameeter 35 = 0) ja fikseerida tulemus.
7. 765 osas jälgida sagedust; brine filter puhastada; kui kordub tihti, tellida kohalik külmatehnik EEV/külmaaine kontrolliks.

## 7. Muudatuse logi

- **15.11.2026 17:08** — `ID_Einst_HREinb_akt` (35) **0 → 1** (Trennsp), kirjutatud otse Luxtroniku 3002 käsuga (menüüs peidetud).
- **15.11.2026 17:08** — kontroller muutis automaatselt `ID_Einst_BWBer_akt` (40) **0 → 1** ja `ID_Einst_BwHup_akt` (148) **0 → 1**.
- **15.11.2026 17:09** — snapshot `data/lux-params/2026-11-15.json`; muudatused `changes-2026-11-15.json`.
- **15.11.2026** — `Warmw. 1` / „Tarbeveeboiler1“ = **Andur** (kontrollitud menüüst).

## 8. Andmete allikad

- Luxtronik 3003 parameetrid (otselugemine, 15.11.2026).
- Soojuse rakenduse ajalugu (myUplink punktid + Luxtronik 3004 diagnostika).
- Pumba veamälu (`pump_errors`), 765 sündmused.
- Alates 15.11.2026 salvestab rakendus iga päev 3003 seadete snapshot'i (`data/lux-params/`), et edaspidi oleks iga muudatus jälgitav.
