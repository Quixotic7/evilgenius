/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
 * distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/* 0.1.2: the store's backup and restore away from the unit (core/glue/qd_bulk.h), with the app over a RAM NOR of
 * 1 MiB as FM1VST's glue has it (core_quadrille.c: the store's offsets from QD_FLASH_REGION with QD_STORE_BLE), and a
 * host that answers as the web manager does (site/manager/eglink.js):
 *   - FZBI: the region's offset as the unit's (0xAF000 in the Bluetooth package's layout), its size, its CRC-32, the
 *     writes still waiting written first; FZBR: the region whole, 256 bytes a read, read back byte for byte; outside
 *     it FZER 11; the replies' frames as egwire.js's parseBulk reads them (the checksum, 7 bits a byte);
 *   - FZSR: refused playing (10), another size (11), a bad image (12: nothing erased); a good one pulled twice, 512
 *     bytes a request, the region the image byte for byte, the app started again on it: the image's MY PRESETS and
 *     projects there; a lossy host (answers lost: each asked again after a second); a host gone mid-write (13 after
 *     90 tries, the app on what is there); a flash that does not read back (14); while it runs nothing else answered;
 *   - FZXD: FZOK 0; another tag: not taken;
 *   - a region of another store's sectors (the .rfm1's host layout before 0.1.2): erased at the attach, an empty store.
 *
 *     test_bulk           exit 1 on any failure */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app.h"
#include "qd_bulk.h"

static int checks, failed;
#define CHECK(c, ...) do { checks++; if (!(c)) { failed++; printf("  FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

#if QD_STORE_BLE
#define FL0 QD_FLASH_REGION             /* (core_quadrille.c FM1CORE_QD_FL0) */
#else
#define FL0 0u
#endif
#define REGION (QD_FLASH_PRJ + QD_FLASH_PRJ_SEC * QDS_SECTOR - QD_FLASH_LIB)
#define FSIZE 0x100000u
static uint8_t FL[FSIZE];
static int bad_prog = -1;               /* (a flash that does not keep a byte: the read-back's test) */
static int f_read(void *c, uint32_t off, void *d, uint32_t n)
{
    (void)c;
    off += FL0;
    if (off + n > FSIZE)
        return -8;
    memcpy(d, FL + off, n);
    return 0;
}
static int f_erase(void *c, uint32_t off)
{
    (void)c;
    off += FL0;
    memset(FL + off / 4096u * 4096u, 0xFF, 4096u);
    return 0;
}
static int f_prog(void *c, uint32_t off, const void *src, uint32_t n)
{
    uint32_t i;
    (void)c;
    off += FL0;
    if (off / 256u != (off + n - 1u) / 256u)
        return -8;
    for (i = 0; i < n; i++)
        FL[off + i] &= ((const uint8_t *)src)[i] ^ (bad_prog >= 0 && off + i == (uint32_t)bad_prog ? 0x01u : 0u);
    return 0;
}
static const qd_flash_t FLASH = {f_read, f_erase, f_prog, 0};
static uint8_t *region(void) { return FL + FL0 + QD_FLASH_LIB; }

static qd_app_t A;
static qd_bulk_t BK;
static uint32_t now;
static int playing, held, restarts, flushes;

/* ---------------------------------------------------------------- the glue's side (core_quadrille.c's) */
static void attach(void)
{
    if (qd_bulk_foreign(&BK) > 0)
        qd_bulk_wipe(&BK);
    qd_persist_attach(&A, &FLASH);
}
static void boot(void)
{
    qd_app_init(&A);
    qd_app_tick(&A, now);
    attach();
}
static void run(uint32_t n)
{
    while (n--) {
        ++now;
        qd_bulk_tick(&BK, now);
        if (!held)
            qd_app_tick(&A, now);
    }
}

/* the host: every frame the module sends, decoded (pack7 undone, the checksum checked as egwire.js parseBulk) */
#define NOUT 16384                     /* (the host layout's region: 1 MiB, 2048 requests a pass) */
static struct { uint8_t d[600]; uint32_t n; int ok; } out[NOUT];
static int nout, rd;
static int io_send(void *c, const uint8_t *w, uint32_t n)
{
    uint32_t i, acc = 0, nb = 0, k = 0, s = 0;
    (void)c;
    if (nout >= NOUT || n < 3 || w[0] != 0xF0 || w[n - 1] != 0xF7)
        return -1;
    for (i = 1; i + 1 < n; i++) {
        if (w[i] & 0x80u)
            return -1;
        acc |= (uint32_t)w[i] << nb;
        nb += 7u;
        if (nb >= 8u) {
            out[nout].d[k++] = (uint8_t)acc;
            acc >>= 8;
            nb -= 8u;
        }
    }
    out[nout].n = k;
    {
        const uint8_t *d = out[nout].d;
        const uint32_t len = d[3] | (uint32_t)d[4] << 8;
        for (i = 6; i < 6 + len && i < k; i++)
            s += d[i];
        out[nout].ok = k >= 7 + len && d[0] == 0 && d[1] == 0x59 && (uint8_t)~s == d[6 + len];
    }
    nout++;
    return 0;
}
static int io_playing(void *c) { (void)c; return playing; }
static void io_flush(void *c) { (void)c; flushes++; qd_persist_flush(&A); }
static void io_hold(void *c, int on) { (void)c; held = on; }
static void io_restart(void *c)
{
    (void)c;
    restarts++;
    boot();
}
static const qd_bulk_io_t IO = {0, io_send, io_playing, io_flush, io_hold, io_restart};

static uint32_t rd32(const uint8_t *p) { return p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }
static void wr32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v, p[1] = (uint8_t)(v >> 8), p[2] = (uint8_t)(v >> 16), p[3] = (uint8_t)(v >> 24); }
/* a decoded frame to the module (ota.c's ota_dec): 00 59 cmd len16 00 body ~sum */
static int give(uint8_t cmd, const uint8_t *body, uint32_t n)
{
    static uint8_t d[700];
    uint32_t i, s = 0;
    d[0] = 0, d[1] = 0x59, d[2] = cmd, d[3] = (uint8_t)n, d[4] = (uint8_t)(n >> 8), d[5] = 0;
    for (i = 0; i < n; i++)
        s += d[6 + i] = body[i];
    d[6 + n] = (uint8_t)~s;
    return qd_bulk_frame(&BK, d, n + 7u, now);
}
static int bulk(const char *tag, int nw, uint32_t w0, uint32_t w1)
{
    uint8_t b[12];
    memcpy(b, tag, 4);
    wr32(b + 4, w0), wr32(b + 8, w1);
    return give(0x46, b, 4u + 4u * (uint32_t)nw);
}
/* the next reply: its tag ("" none), its data */
static const uint8_t *reply(char *tag, uint32_t *n)
{
    while (rd < nout && out[rd].d[2] != 0x46)
        rd++;
    if (rd >= nout) {
        tag[0] = 0;
        return 0;
    }
    memcpy(tag, out[rd].d + 6, 4), tag[4] = 0;
    *n = (out[rd].d[3] | (uint32_t)out[rd].d[4] << 8) - 4u;
    CHECK(out[rd].ok, "the reply %s reads as egwire.js parseBulk reads it", tag);
    return out[rd++].d + 10;
}
static uint32_t crc(const uint8_t *p, uint32_t n) { return qd_bulk_crc32(0, p, n); }

/* the web manager's restore (eglink.js restore): each read request answered from img, every lose-th lost (0: none),
 * none after stop answers (0: never), until FZOK / FZER or 200 s; -> its code (0 FZOK), the requests answered */
static int restore(const uint8_t *img, uint32_t len, uint32_t c, int lose, int stop, int *served)
{
    char tag[5];
    uint32_t n, t;
    int seen = 0;
    *served = 0;
    nout = rd = 0;
    bulk("FZSR", 2, len, c);
    for (t = 0; t < 200000u; t++) {
        while (rd < nout) {
            const uint8_t *d = out[rd].d;
            if (d[2] == 0x30) {                       /* a read request (eglink.js parseRequest) */
                const uint32_t a = rd32(d + 7), q = d[11] | (uint32_t)d[12] << 8;
                uint8_t r[8 + 512];
                rd++;
                seen++;
                CHECK(out[rd - 1].ok && out[rd - 1].n == 15 && q == 512 && a + q <= len, "a read request: 512 bytes of the image");
                if ((lose && seen % lose == 0) || (stop && *served >= stop))
                    continue;
                r[0] = d[6];
                wr32(r + 1, a), r[5] = (uint8_t)q, r[6] = (uint8_t)(q >> 8), r[7] = 0;
                memcpy(r + 8, img + a, q);
                give(0x30, r, 8u + q);
                (*served)++;
                continue;
            }
            if (reply(tag, &n)) {
                if (!strcmp(tag, "FZOK"))
                    return 0;
                if (!strcmp(tag, "FZER"))
                    return (int)rd32(out[rd - 1].d + 10);
            }
        }
        run(1);
    }
    return -1;
}

/* a store's MY PRESETS (and, more, a second project), made by the app on the flash as it is */
static void presets(const char *stem, int count, int more)
{
    qd_sound_t s;
    char nm[QD_SOUND_NAME];
    int k;
    qd_factory_get(&A, 1, &s);
    for (k = 0; k < count; k++) {
        snprintf(nm, sizeof nm, "%s%d", stem, k);
        s.patch[5] = (int16_t)(k & 15);
        CHECK(qd_lib_store(&A, k, nm, s.patch), "MY PRESET %s stored", nm);
    }
    if (more)
        CHECK(qd_proj_new(&A, 1) && A.per.pexists[1], "a second project");
    run(3000);
    CHECK(qd_persist_flush(&A), "flushed");
}

int main(void)
{
    static uint8_t img[REGION], good[REGION], before[REGION];
    char tag[5];
    uint32_t n, off, c;
    const uint8_t *p;
    int rc, served, k;

    printf("the region: 0x%X + %u bytes (%u sectors), FZBI's offset 0x%X\n", FL0 + QD_FLASH_LIB, REGION,
           REGION / QDS_SECTOR, FL0 + QD_FLASH_LIB);
#if QD_STORE_BLE
    CHECK(FL0 + QD_FLASH_LIB == 0xAF000u && REGION == 49u * 4096u && QD_NPROJ == 4 && QD_NLIB == 128 &&
              QDS_MAGIC == 0x32424745u, "the Bluetooth package's store: 0xAF000, 49 sectors, 4 projects, 128 MY "
          "PRESETS, \"EGB2\" (site/manager/egstore.js LAYOUT)");
#endif

    /* ---- the image to restore: another store, made on the same flash first */
    memset(FL, 0xFF, sizeof FL);
    qd_bulk_init(&BK, &IO, &FLASH, QD_FLASH_LIB, REGION, FL0 + QD_FLASH_LIB);
    boot();
    presets("RESTORED", 9, 1);
    memcpy(good, region(), REGION);

    /* ---- this store: a few presets, an edit still waiting */
    memset(FL, 0xFF, sizeof FL);
    boot();
    presets("HERE", 3, 0);
    CHECK(qd_lib_used(&A, 0) && !strcmp(qd_lib_name(&A, 0), "HERE0") && !qd_lib_used(&A, 3) && !A.per.pexists[1],
          "this store: 3 presets, one project");
    {
        qd_sound_t s;
        qd_factory_get(&A, 2, &s);
        qd_lib_store(&A, 3, "LATE", s.patch);
    }
    run(100);
    CHECK(qd_persist_dirty(&A), "an edit not written yet");

    /* ---- FZBI */
    nout = rd = 0;
    flushes = 0;
    CHECK(bulk("FZBI", 0, 0, 0), "FZBI taken");
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZBI") && n == 12, "FZBI's answer (%s, %u bytes)", tag, n);
    CHECK(p && rd32(p) == FL0 + QD_FLASH_LIB && rd32(p + 4) == REGION && rd32(p + 8) == crc(region(), REGION),
          "FZBI: the offset, the size, the region's CRC-32 (%08X)", p ? rd32(p + 8) : 0);
    CHECK(flushes == 1 && !qd_persist_dirty(&A), "FZBI: the edit waiting written first");

    /* ---- FZBR: the backup */
    nout = rd = 0;
    for (off = 0; off < REGION; off += 256u) {
        bulk("FZBR", 2, off, 256);
        p = reply(tag, &n);
        if (!p || strcmp(tag, "FZBD") || n != 260 || rd32(p) != off)
            break;
        memcpy(img + off, p + 4, 256);
        nout = rd = 0;
    }
    CHECK(off == REGION && !memcmp(img, region(), REGION), "FZBR: the region whole, 256 bytes a read (%u)", off);
    CHECK(crc(img, REGION) == crc(region(), REGION), "the backup's CRC-32 is FZBI's");
    bulk("FZBR", 2, REGION - 100u, 100);
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZBD") && n == 104 && !memcmp(p + 4, region() + REGION - 100u, 100), "FZBR: the last bytes");
    bulk("FZBR", 2, REGION - 100u, 101);
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZER") && rd32(p) == 11, "FZBR past the end: FZER 11");
    bulk("FZBR", 2, 0, 257);
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZER") && rd32(p) == 11, "FZBR of 257 bytes: FZER 11");

    /* ---- FZXD, another tag, another cmd */
    nout = rd = 0;
    {
        uint8_t b[16] = {'F', 'Z', 'X', 'D', 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0};
        CHECK(give(0x46, b, 16), "FZXD taken");
        p = reply(tag, &n);
        CHECK(p && !strcmp(tag, "FZOK") && rd32(p) == 0, "FZXD: FZOK 0, the data is there");
    }
    nout = rd = 0;
    CHECK(!bulk("ABCD", 0, 0, 0) && !give(0x11, 0, 0) && nout == 0, "another tag, the handshake: not taken, no answer");

    /* ---- FZSR refused */
    memcpy(before, region(), REGION);
    playing = 1;
    nout = rd = 0;
    bulk("FZSR", 2, REGION, crc(good, REGION));
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZER") && rd32(p) == 10 && !qd_bulk_busy(&BK), "FZSR playing: FZER 10");
    playing = 0;
    bulk("FZSR", 2, REGION - 512u, crc(good, REGION - 512u));
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZER") && rd32(p) == 11 && !qd_bulk_busy(&BK), "FZSR of another size: FZER 11");
    restarts = 0;
    rc = restore(good, REGION, crc(good, REGION) ^ 1u, 0, 0, &served);
    CHECK(rc == 12 && served == (int)(REGION / 512u) && !memcmp(before, region(), REGION) && !restarts && !held,
          "a bad image: pulled once, FZER 12, nothing erased, the app as it was (%d, %d reads)", rc, served);

    /* ---- FZSR: the restore */
    restarts = 0;
    BK.reqs = 0;
    rc = restore(good, REGION, crc(good, REGION), 0, 0, &served);
    CHECK(rc == 0 && served == 2 * (int)(REGION / 512u) && restarts == 1 && !held && BK.reqs == (uint32_t)served,
          "the restore: pulled twice, 512 bytes a request, FZOK, the app started again (%d, %d reads)", rc, served);
    CHECK(!memcmp(region(), good, REGION), "the region is the image byte for byte");
    for (k = 0; k < 9 && qd_lib_used(&A, k); k++) {
        char nm[16];
        snprintf(nm, sizeof nm, "RESTORED%d", k);
        if (strcmp(qd_lib_name(&A, k), nm))
            break;
    }
    CHECK(k == 9 && !qd_lib_used(&A, 9) && A.per.on && A.per.pexists[1],
          "the app sees the image's MY PRESETS (%d of 9) and its second project, none of this store's", k);
    run(5000);
    CHECK(qd_persist_flush(&A) && A.per.on, "and goes on writing to it");

    /* ---- a lossy host: an answer in LOSE lost (about 25 a restore) */
    memset(region(), 0xFF, REGION);
    boot();
    restarts = 0;
    BK.reqs = 0;
    rc = restore(good, REGION, crc(good, REGION), (int)(2u * REGION / 512u / 25u) + 1, 0, &served);
    CHECK(rc == 0 && served == 2 * (int)(REGION / 512u) && BK.reqs > (uint32_t)served && !memcmp(region(), good, REGION),
          "a lossy host: each lost answer asked again a second later, the restore whole (%d, %u requests)", rc, BK.reqs);

    /* ---- not answered for a second: asked again then, not before */
    memset(region(), 0xFF, REGION);
    boot();
    nout = rd = 0;
    bulk("FZSR", 2, REGION, crc(good, REGION));
    CHECK(qd_bulk_busy(&BK) && held && nout == 1 && out[0].d[2] == 0x30, "FZSR: a read request, the app held");
    CHECK(bulk("FZBI", 0, 0, 0) && nout == 1, "a restore running: FZBI not answered");
    run(QD_BULK_TRY_MS - 1u);
    CHECK(nout == 1, "no answer: not asked again before a second");
    run(1);
    CHECK(nout == 2 && out[1].d[2] == 0x30 && rd32(out[1].d + 7) == 0, "asked again at a second");
    run(QD_BULK_TRY_MS * QD_BULK_TRIES);
    p = reply(tag, &n);
    CHECK(p && !strcmp(tag, "FZER") && rd32(p) == 12 && !held && nout == (int)QD_BULK_TRIES + 1,
          "a host gone while it checks: FZER 12 after %u tries, nothing written", QD_BULK_TRIES);

    /* ---- a host gone mid-write: 13, the app on what is there */
    memset(region(), 0xFF, REGION);
    boot();
    restarts = 0;
    rc = restore(good, REGION, crc(good, REGION), 0, (int)(REGION / 512u) + 40, &served);
    CHECK(rc == 13 && restarts == 1 && !held && A.per.on, "a host gone mid-write: FZER 13, the app started again on "
          "the half-written region (%d)", rc);
    run(2000);

    /* ---- a flash that does not read back: 14 */
    memset(region(), 0xFF, REGION);
    boot();
    restarts = 0;
    bad_prog = (int)(FL0 + QD_FLASH_LIB + 5000u);
    rc = restore(good, REGION, crc(good, REGION), 0, 0, &served);
    bad_prog = -1;
    CHECK(rc == 14 && restarts == 1 && !held, "the region not read back as the image: FZER 14 (%d)", rc);

    /* ---- another store's sectors in the region (the .rfm1's host layout before 0.1.2): erased, an empty store */
    memset(FL, 0xFF, sizeof FL);
    for (off = 0; off < REGION; off += QDS_SECTOR) {
        uint8_t *s = region() + off;
        wr32(s, 0x32534745u ^ (QDS_MAGIC == 0x32534745u ? 0x01000000u : 0u));   /* ("EGS2", the host's) */
        wr32(s + 4, off / QDS_SECTOR + 1u);
        s[8] = 0x5A, s[9] = 0x5A, s[10] = 0xA5, s[11] = 0xA5;
        for (k = 256; k < 4096; k++)
            s[k] = (uint8_t)(k * 7 + off);
    }
    CHECK(qd_bulk_foreign(&BK) == (int)(REGION / QDS_SECTOR), "another store's sectors: all foreign");
    boot();
    for (c = 0, off = 0; off < REGION; off += QDS_SECTOR)
        c += rd32(region() + off) == QDS_MAGIC || rd32(region() + off) == 0xFFFFFFFFu;
    CHECK(c == REGION / QDS_SECTOR && A.per.on && !qd_lib_used(&A, 0) && A.per.pdemo,
          "erased at the attach: an empty store, the first project with its demos");
    run(5000);
    CHECK(qd_persist_flush(&A) && qd_bulk_foreign(&BK) == 0, "and written to as the store");
    nout = rd = 0;
    bulk("FZBI", 0, 0, 0);
    p = reply(tag, &n);
    CHECK(p && rd32(p + 8) == crc(region(), REGION), "FZBI on it");

    printf("test_bulk: %d checks, %d failed\n", checks, failed);
    return failed ? 1 : 0;
}
