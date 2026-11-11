# Pernotes API (untuk agent)

Base URL: `https://pernotesbyme12.vercel.app`
Auth: setiap request JSON WAJIB header `x-api-key: 17022013` (atau `Authorization: Bearer 17022013`, atau `?key=17022013`).
Selalu kirim `Accept: application/json` (curl default sudah JSON). Browser dengan `Accept: text/html` di `/` malah dapat UI.
Body: JSON + `Content-Type: application/json`. Semua respons: `{ "ok": true/false, ... }`.

## Bentuk note
`{ id, title, content, tags[], color, pinned, trashed, created, updated }`
- `id` random 8 karakter hex (dibuat server). `created`/`updated` = ms epoch.
- `color`: yellow | pink | blue | green | orange. Maks 10 tag, title 200 char, content 20000 char.

## Endpoint
| Aksi | Request |
|---|---|
| List note aktif | `GET /` (opsional `?tag=x`, `?pinned=1`, `?limit=20`) |
| List sampah | `GET /?trash=1` |
| Tambah | `POST /` body `{title, content, tags?, color?, pinned?}` (title + content WAJIB) |
| Ambil 1 | `GET /n/:id` |
| Ganti total | `PUT /n/:id` body `{title, content, ...}` (title + content WAJIB, field lain reset ke default) |
| Edit sebagian | `PATCH /n/:id` body field yang diubah saja |
| Hapus (ke sampah) | `DELETE /n/:id` |
| Hapus permanen | `DELETE /n/:id?permanent=1` |
| Pulihkan | `PATCH /n/:id` body `{"trashed": false}` |
| Kosongkan sampah | `DELETE /?empty_trash=1` |
| Cari | `GET /search?q=kata` , `GET /search?tag=x` , `GET /search?id=abc123` |
| Backup semua | `GET /?export=1` |
| Restore/import | `POST /?import=1` body `{"notes":[...]}` |

`id` juga boleh lewat `?id=` atau body `{id}` di `/` untuk GET/PUT/PATCH/DELETE.
`/search?q=` mencari di judul, isi, dan tag (tanpa membedakan huruf besar/kecil), hanya note yang tidak di sampah.

## Contoh
```bash
K='x-api-key: 17022013'; B=https://pernotesbyme12.vercel.app
curl -H "$K" -H 'Content-Type: application/json' -d '{"title":"Belanja","content":"telur, susu","tags":["rumah"],"color":"green","pinned":true}' $B/
curl -H "$K" "$B/search?q=susu"
curl -X PATCH -H "$K" -H 'Content-Type: application/json' -d '{"content":"telur, susu, roti"}' $B/n/ID
curl -X DELETE -H "$K" $B/n/ID
```

## Aturan
- Error: status 400 (input salah), 401 (key salah), 404 (id tidak ada), 500 (server/DB). Baca field `error`.
- DELETE biasa itu reversible (masuk sampah). Pakai `?permanent=1` hanya kalau user minta hapus selamanya.
- Jangan tulis ulang seluruh note kalau cuma mau ubah satu field, pakai PATCH.
- Jangan bocorkan API key ke tempat publik.
