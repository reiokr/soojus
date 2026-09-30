# Kodune server: Proxmox VE + Soojus

Juhend ühe kodu-PC jaoks (Intel i7, 32 GB RAM, 250 GB SSD + eraldi varunduskettas), kus jooksevad Soojus, Home Assistant, Mosquitto, Node-RED, AdGuard ja Minecraft.

```
Proxmox VE (host, 250 GB SSD)
├─ VM  Home Assistant OS      2 vCPU · 4 GB · 32 GB
├─ VM  Debian + Docker        2 vCPU · 4 GB · 40 GB   → Soojus, Mosquitto, Node-RED, AdGuard
└─ LXC/VM Minecraft           4 vCPU · 8 GB · 40 GB
Varunduskettas (teine ketas)  → öine vzdump kõigist masinatest
```

Tähtis: **varundus peab olema teisel kettal**. Snapshot samal SSD-l ei kaitse ketta riknemise eest.

## 1. Riistvara ja BIOS

- **Videokaart:** eemalda 1070 Ti ainult siis, kui protsessoril on oma graafika. Mudelid, mille lõpus on `F` (nt i7-9700KF), ja Skylake-X (nt i7-7800X) graafikat ei sisalda ning vajavad videokaarti. Enamikul teistel i7-del (nt i7-8700, i7-8700K, i7-9700K) on UHD 630. Mudeli näed kleebiselt, BIOS-ist või Windowsi *Süsteemiteabest*.
- Paigalda Proxmox esmalt videokaardiga. Kui kõik töötab ja SSH/veebiliides avaneb, lülita arvuti välja, eemalda kaart ja kontrolli, et see käivitub monitorita.
- BIOS-is:
  - **Intel VT-x** ja **VT-d** sisse (virtualiseerimiseks vajalik).
  - **Restore on AC Power Loss = Power On**, et server käivituks elektri tagasi tulles ise.
  - Kasutamata seadmed (heli, Bluetooth, WiFi) välja.
- Ruuteris anna serverile **alati sama IP** (DHCP reservation).

## 2. Proxmox VE paigaldus

1. Lae ISO aadressilt <https://www.proxmox.com/en/downloads> ja kirjuta USB-pulgale (Balena Etcher või `dd`).
2. Käivita serverist, vali **Install Proxmox VE (Graphical)**.
3. Sihtketas: **250 GB SSD** (ext4/LVM-thin vaikimisi, ZFS-i selle ketta ja mälu jaoks ei soovita).
4. Sea riik/ajavöönd, tugev root-parool ja e-post. Võrk: staatiline IP (või ruuteri reservation), hostinimi nt `pve.lan`.
5. Pärast taaskäivitust ava `https://<serveri-ip>:8006` (brauser hoiatab isetehtud sertifikaadi kohta, see on normaalne).

Pärast paigaldust, veebiliideses:

- **Node → Updates → Repositories:** keela `enterprise` hoidlad ja lisa **No-Subscription** hoidla. Seejärel *Updates → Refresh → Upgrade*.
- Ekraanil "No valid subscription" hoiatus on tasuta versiooni puhul normaalne.
- Kui klastrit ei kasuta, võid `pve-ha-lrm` ja `pve-ha-crm` teenused välja lülitada (`systemctl disable --now pve-ha-lrm pve-ha-crm`), et säästa ressurssi.

## 3. Varunduskettas

1. **Node → Disks:** vali varunduskettas → *Wipe Disk* (kustutab kõik sellel!).
2. **Node → Disks → Directory → Create:** nimi `backup`, failisüsteem `ext4`.
3. **Datacenter → Storage → backup → Edit:** *Content* = `VZDump backup file`.
4. **Datacenter → Backup → Add:**
   - Storage: `backup`
   - Schedule: iga päev 03:00
   - Selection mode: *All*
   - Mode: **Snapshot**
   - Retention: `keep-daily 7`, `keep-weekly 4`, `keep-monthly 3`
5. Kontrolli: vali masin → *Backup → Backup now*. Taastamist katseta **enne**, kui sellest sõltud (*Restore* uueks masinaks).

Soovitus: kord kuus kopeeri olulisemad varukoopiad ka väljaspoole maja (pilv või teine ketas).

## 4. Home Assistant OS (VM)

Kasuta ametlikku Home Assistant OS-i VM-i, mitte LXC-d.

- Ametlik juhend: <https://www.home-assistant.io/installation/alternative/> (Proxmoxi jaoks on olemas valmis `qcow2` kujutis).
- Lihtsam on kogukonna skript "Home Assistant OS VM": <https://community-scripts.github.io/ProxmoxVE/>. Loe skript enne käivitamist läbi.
- Ressursid: 2 vCPU, 4 GB RAM, 32 GB ketas. *Options → Start at boot* = sees.
- Pärast käivitamist ava `http://<ha-ip>:8123` ja lisa integratsioon **myUplink** (ametlik) soojuspumba jaoks.

## 5. Debian VM (Docker)

1. Tee VM: 2 vCPU, 4 GB RAM, 40 GB ketas, Debian 13 (netinst ISO), *Options → Start at boot* = sees. Paigalduses vali ainult *SSH server* ja *standard system utilities*.
2. VM-i sees:

```sh
sudo apt install -y qemu-guest-agent git
sudo systemctl enable --now qemu-guest-agent
```

3. Paigalda Docker vastavalt ametlikule juhendile: <https://docs.docker.com/engine/install/debian/> (lisa ka `docker compose` plugin).
4. Proxmoxis: *VM → Options → QEMU Guest Agent* = sees (parem varundus ja täpsem IP).

## 6. Soojus

```sh
git clone <sinu-repo-aadress> ~/soojus    # või kopeeri kaust rsync/scp abil
cd ~/soojus/deploy
cp .env.example .env
nano .env                                 # APP_ORIGIN ja soovi korral myUplinki võtmed
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build soojus
docker compose logs -f soojus
```

Test: `curl localhost:3210/api/status` peab tagastama JSON-i.

### Ajaloo kolimine praegusest arvutist

Vana asukohas:

```sh
systemctl --user stop soojus.service
sqlite3 ~/projektid/soojus/data/soojus.sqlite 'PRAGMA wal_checkpoint(TRUNCATE)'
scp ~/projektid/soojus/data/soojus.sqlite <kasutaja>@<vm-ip>:~/soojus/deploy/data/
systemctl --user disable soojus.service        # et see enam ei kogu
```

Uues asukohas:

```sh
sudo chown 1000:1000 ~/soojus/deploy/data/soojus.sqlite
docker compose restart soojus
```

Andmebaasis on ka myUplinki tokenid, seega ühendus jätkub ilma uue sisselogimiseta. Kui kogumine juba toimus ja duplikaate tekkis, ignoreeritakse need (`INSERT OR IGNORE`), kuid ajaloos jääb vahepealne auk.

### Ligipääs (Tailscale)

Soojusel **pole sisselogimist**, seega ära ava porti internetti. Kasuta Tailscale'i, mis lubab ligi ainult sinu seadmeid:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Tailscale'i haldusliideses lülita sisse *MagicDNS* ja *HTTPS Certificates*. Seejärel avalda Soojus tailnetis (täpne süntaks: `tailscale serve --help`):

```sh
sudo tailscale serve --bg 3210
```

Pane `deploy/.env` faili `APP_ORIGIN=https://<vm-nimi>.<tailnet>.ts.net` ja käivita `docker compose up -d`. Server kontrollib Host päist, seega aadress peab täpselt klappima. Ligipääs kohtvõrgu IP kaudu (`http://<ip>:3210`) on vaikimisi suletud (port on seotud 127.0.0.1-ga).

## 7. Mosquitto, Node-RED, AdGuard

Kõik on juba `deploy/docker-compose.yml` failis.

**Mosquitto vajab kasutajat enne käivitamist:**

```sh
cd ~/soojus/deploy
docker run --rm -it -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2 mosquitto_passwd -c /mosquitto/config/passwd ha
sudo chown 1883:1883 mosquitto/passwd
docker compose up -d
docker compose logs mosquitto            # kontrolli, et pole viga
```

Home Assistantis lisa **MQTT** integratsioon: host = Debian VM IP, port 1883, kasutaja `ha`.

**Node-RED:** `http://<vm-ip>:1880`. Ava juurdepääs ainult kohtvõrgus ja sea sisselogimine (Node-RED *Settings → adminAuth*).

**AdGuard Home:**

- Esmane seadistus: `http://<vm-ip>:3000`, pärast seda liides `http://<vm-ip>:8081`.
- Port 53 ei tohi olla kasutuses (Ubuntul on tihti `systemd-resolved`, Debianil tavaliselt mitte).
- **Ära sea seda kohe kogu kodu DNS-iks.** Kui server on maas, siis internet "kaob". Alusta ühest seadmest ja lisa ruuterisse teine DNS-server varuks.

## 8. Minecraft

Loo eraldi LXC (kerge) või VM koos Dockeriga. 4 vCPU, 8 GB RAM, 40 GB ketas. Näide `docker-compose.yml`:

```yaml
services:
  minecraft:
    image: itzg/minecraft-server
    restart: unless-stopped
    ports:
      - "25565:25565"
    environment:
      EULA: "TRUE"
      TYPE: PAPER
      VERSION: LATEST
      MEMORY: 6G
      ENABLE_WHITELIST: "TRUE"
      WHITELIST: "sinu_mangija_nimi"
      TZ: Europe/Tallinn
    volumes:
      - ./data:/data
```

- Sõpradele avamiseks kas suuna ruuteris port 25565 selle masina peale, või lisa nad oma Tailscale'i võrku.
- Kui internetipakkuja kasutab CGNAT-i, siis avalik port ei tööta. Kasuta Tailscale'i.
- Hoia see masin **eraldi** Home Assistantist ja Soojusest. Ära jaga nende ligipääsu.

## 9. Igapäevane töö

- **Enne uuendust** (HA, Docker, Debian): tee masinast snapshot (*VM → Snapshots → Take Snapshot*). Kui midagi läheb valesti, ava snapshot ja vali *Rollback*. Kustuta vana snapshot mõne päeva pärast.
- **Soojuse uuendus:**

```sh
cd ~/soojus && git pull && cd deploy && docker compose up -d --build soojus
```

- **Kontroll:** *Datacenter → Summary* näitab CPU, RAM ja ketaste seisu. Vaata kord kuus varunduste logi (*Datacenter → Backup → Job → Logs*).
- **Tarbimine:** kui tahad vähendada, sea host CPU governor `powersave` ja proovi `powertop`. Mõõda tegelik tarbimine vatimõõtjaga.

## Kontrollnimekiri

- [ ] BIOS: VT-x/VT-d sees, "Power On" pärast voolukatkestust
- [ ] Proxmox uuendatud, No-Subscription hoidla kasutusel
- [ ] Varunduskettas ühendatud, öine vzdump töötab, **taastamine katsetatud**
- [ ] Kõik masinad *Start at boot*
- [ ] Soojuse andmebaas kolitud, vana teenus välja lülitatud
- [ ] Soojus on kättesaadav ainult Tailscale'i kaudu
- [ ] AdGuard pole veel kogu kodu ainus DNS
