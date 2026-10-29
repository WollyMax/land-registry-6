# බලපත්‍ර හා දීමනා පත්‍ර තෝම්බුව — Backend

`public/index.html` (frontend) සඳහා database + login සහිත server එක.
**Install කිරීමට කිසිවක් අවශ්‍ය නැත** — Node.js (අනුවාදය 22.13 හෝ ඊට වැඩි) තිබීම පමණි.

## 1. පළමු වරට පටන් ගැනීම

1. https://nodejs.org වෙතින් **LTS** Node.js install කරන්න.
2. `start.bat` double-click කරන්න (හෝ cmd එකේ `node server.js`).
3. Browser එක `http://localhost:3000` ඉබේම විවෘත වේ.
4. **පළමු වරට** "Admin ගිණුම සාදන්න" පිටුව පෙනේ — පරිශීලක නාමයක් සහ මුරපදයක් (අකුරු 8+) දී ගිණුම සාදන්න.
5. ඉන්පසු උඩ තියෙන **"පරිශීලකයින්"** බොත්තමෙන් අනිත් කාර්ය මණ්ඩලයට ගිණුම් සාදන්න.

## 2. ගිණුම් වර්ග

| වර්ගය | කළ හැකි දේ |
|-------|-------------|
| **User** | සටහන් බැලීම, එක් කිරීම, සංස්කරණය, මැකීම, සෙවීම, PDF |
| **Admin** | User ට කළ හැකි සියල්ල + පරිශීලක ගිණුම් කළමනාකරණය + Backup / Restore |

- පැය 12කට පසු නැවත login විය යුතුයි.
- මුරපද scrypt ලෙස hash කර ගබඩා වේ (සාමාන්‍ය text ලෙස නොවේ).
- වැරදි මුරපද 8ක් ගැහුවොත් විනාඩි 10ක් අවහිර වේ.
- **මුරපදය අමතක වුණොත්** (server computer එකේ, `registry` folder එකේ cmd එකකින්):
  ```
  node server.js reset-password <පරිශීලක-නාමය> <අලුත්-මුරපදය>
  ```

## 3. කාර්යාලයේ සියලු computers වලින් භාවිතා කිරීම

Server computer එක (හැමවිටම on කර තබන computer එක) මත:

1. `server-setup.bat` මත **right-click → Run as administrator**.
   - Firewall එකේ port 3000 විවෘත කරයි
   - Windows පටන් ගන්නා සැම විටම server එක ඉබේම පටන් ගනී (cmd කවුළුවක් විවෘතව තබාගත යුතු නැත)
   - අවසානයේ computer එකේ IP ලිපිනය පෙන්වයි (උදා: `192.168.1.10`)
2. අනිත් සියලු computers වල browser එකේ `http://192.168.1.10:3000` විවෘත කර login වන්න.
3. පහසුව සඳහා එම address එක browser එකේ bookmark කරන්න.

> **වැදගත්:** Server computer එකේ IP ලිපිනය වෙනස් නොවීමට router එකේ (හෝ Windows හි) **fixed IP** එකක් දෙන්න. නැත්නම් IP එක වෙනස් වූ දා සිට අනිත් computers වලින් විවෘත නොවේ.

ඉවත් කිරීමට: `server-remove.bat` (Run as administrator).
Server log එක `server.log` ගොනුවේ තිබේ.

## 4. Internet හරහා (ගෙදර / වෙනත් කාර්යාල වලින්) භාවිතා කිරීම

**Router එකේ port 3000 කෙලින්ම internet එකට විවෘත නොකරන්න** (HTTP නිසා මුරපද සහ හැඳුනුම්පත් දත්ත සංකේතනය නොවේ).
HTTPS සහිත ආරක්ෂිත ක්‍රම:

- **Cloudflare Tunnel** (නොමිලේ; port open කිරීම අවශ්‍ය නැත): server computer එකේ `cloudflared` install කර tunnel එක `http://localhost:3000` වෙත යොමු කරන්න. ඉන්පසු server එක පහත සේ පටන් ගන්න:
  ```
  set HOST=127.0.0.1
  set TRUST_PROXY=1
  set COOKIE_SECURE=1
  node server.js
  ```
- **VPS (cloud server)** + Caddy/nginx (HTTPS සමඟ) — `TRUST_PROXY=1` සහ `COOKIE_SECURE=1` සමඟම.

`TRUST_PROXY=1` දැමිය යුත්තේ server එක **reverse proxy / tunnel එකක් පිටුපස පමණක්** (`HOST=127.0.0.1`) ඇති විට පමණි.

## Environment variables

| Variable        | Default         | විස්තරය                                        |
|-----------------|-----------------|--------------------------------------------------|
| `PORT`          | `3000`          | Server port එක                                    |
| `HOST`          | `0.0.0.0`       | Listen කරන address (`127.0.0.1` = මේ computer පමණි) |
| `DB_PATH`       | `./registry.db` | Database ගොනුව                                    |
| `TRUST_PROXY`   | —               | `1` = reverse proxy පිටුපස (client IP සඳහා)         |
| `COOKIE_SECURE` | —               | `1` = HTTPS පමණක් (internet භාවිතයේදී)             |

## ගොනු

- `server.js` — API + login + static file server
- `public/index.html` — ප්‍රධාන තෝම්බු පිටුව
- `public/login.html` — පිවිසුම් පිටුව
- `public/admin.html` — පරිශීලක කළමනාකරණය (admin)
- `registry.db` — දත්ත ගබඩාව (SQLite; ස්වයංක්‍රීයව සෑදේ). සටහන් + පරිශීලක ගිණුම් දෙකම මෙහි තිබේ.
- `start.bat` — අතින් පටන් ගැනීමට
- `server-setup.bat` / `server-remove.bat` — ඉබේම පටන් ගැනීම සකස් කිරීම / ඉවත් කිරීම

## Database tables

| Table                | අන්තර්ගතය                                          |
|----------------------|-----------------------------------------------------|
| `records`            | දීමනාපත්‍ර සටහන් (වසම, නම්, හැ.අ., බලපත්‍ර අංකය, ඉඩම, මායිම්) |
| `children`           | දරුවන්ගේ නම් සහ හැඳුනුම්පත් අංක                      |
| `subsequent_actions` | 11. පසු කටයුතු                                       |
| `settings`           | කාර්යාලයේ නම                                         |
| `users`, `sessions`  | පරිශීලක ගිණුම් සහ login sessions                      |

## Backup (අත්‍යවශ්‍යයි)

- Admin ලෙස login වී පිටුවේ **"සියලු දත්ත Backup බාගන්න"** බොත්තම නිතිපතා භාවිතා කරන්න, හෝ
- `registry.db` (සහ තිබේ නම් `registry.db-wal`) ගොනු නිතිපතා වෙනත් තැනකට (USB / වෙනත් computer) copy කරන්න.
- "Restore" කිරීමෙන් දැනට ඇති සියලු සටහන් ප්‍රතිස්ථාපනය වේ (පරිශීලක ගිණුම් වෙනස් නොවේ).
