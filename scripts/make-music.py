#!/usr/bin/env python3
"""Genereerib public/audio/*.mp3: viis rahulikku ~60 s taustamuusika silmust Elav kodu vaate jaoks.
Kõik helid sünteesitakse siin (Rhodes-laadne klaver, nailonkitarr, bass, harjad, padi, vinüülipraks), seega pole kolmanda osapoole autoriõigusi. Tempo ja taktide arv on valitud nii, et iga lugu
kestab täpselt 60 s ning kõik sabad (kaja) keeratakse algusesse tagasi, mistõttu silmus on pausita ja kliksita.
Käivitus: python3 scripts/make-music.py  (vajab numpy, scipy ja ffmpeg-i)
Lugude nimekiri (id, pealkiri) peab ühtima failiga src/next/live/ambience.js."""
import pathlib, subprocess, tempfile, wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
TAU = 2 * np.pi
rng = np.random.default_rng(0)

def reseed(seed):
    global rng
    rng = np.random.default_rng(seed)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def rms(x): return float(np.sqrt(np.mean(np.square(x))))

class Track:
    def __init__(self, n, pad): self.n = n; self.x = np.zeros(n + pad)
    def add(self, t, sig, gain=1.0):
        i = int(round(t * SR)) % self.n
        k = min(len(sig), len(self.x) - i)
        self.x[i:i + k] += sig[:k] * gain
    def fold(self):
        out = self.x[:self.n].copy(); tail = self.x[self.n:]
        out[:len(tail)] += tail
        return out

def ep(f, dur, vel):
    n = int((dur + 1.4) * SR); t = np.arange(n) / SR
    idx = (0.25 + 1.0 * vel) * np.exp(-t * 7.0) + 0.15 * vel
    car = np.sin(TAU * f * t + idx * np.sin(TAU * f * t))
    car += 0.5 * np.sin(TAU * f * 1.0025 * t + idx * np.sin(TAU * f * 1.0025 * t))
    bell = 0.025 * vel * np.sin(TAU * f * 14 * t) * np.exp(-t * 30)
    amp = (1 - np.exp(-t / 0.004)) * np.exp(-t * 1.3)
    amp *= np.where(t > dur, np.exp(-(t - dur) * 6.5), 1.0)
    return (car * 0.45 + bell) * amp * vel

def bass(f, dur, vel):
    n = int((dur + 0.5) * SR); t = np.arange(n) / SR
    s = np.sin(TAU * f * t) + 0.45 * np.sin(TAU * 2 * f * t) * np.exp(-t * 5) + 0.18 * np.sin(TAU * 3 * f * t) * np.exp(-t * 9)
    amp = (1 - np.exp(-t / 0.007)) * np.exp(-t * 2.0)
    amp *= np.where(t > dur, np.exp(-(t - dur) * 14), 1.0)
    return s * amp * vel

def pad(freqs, dur):
    n = int((dur + 4.0) * SR); t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for det in (-0.004, 0.0, 0.004):
            ph = rng.uniform(0, TAU)
            vib = 1 + 0.0015 * np.sin(TAU * 0.3 * t + ph)
            for k, w in ((1, 1.0), (2, .42), (3, .2), (4, .1)):
                out += w * np.sin(TAU * f * (1 + det) * k * vib * t + ph * k)
    amp = np.minimum(t / 1.8, 1.0) ** 2 * np.where(t > dur, np.exp(-(t - dur) * 1.6), 1.0)
    return out * amp / (len(freqs) * 3)

def kick(vel):
    t = np.arange(int(.45 * SR)) / SR
    ph = TAU * np.cumsum(46 + 85 * np.exp(-t * 32)) / SR
    return np.sin(ph) * np.exp(-t * 8.5) * vel

def brush(vel):
    t = np.arange(int(.35 * SR)) / SR
    noise = bp(rng.standard_normal(len(t)), 1400, 7500)
    body = np.sin(TAU * 185 * t) * np.exp(-t * 32) * 0.35
    return (noise * np.minimum(t / .012, 1) * np.exp(-t * 13) + body) * vel

def hat(vel):
    t = np.arange(int(.12 * SR)) / SR
    return hp(rng.standard_normal(len(t)), 6500) * np.exp(-t * 55) * vel

def pluck(f, dur, vel):
    """Nailonkeelega kitarri laadne näpmine: ülemtoonid vaibuvad kiiresti, seega heli on pehme ja soe."""
    n = int((dur + 1.8) * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for k in range(1, 9):
        if f * k > 4500: break
        s += np.sin(TAU * f * k * t + k) / k ** 1.3 * np.exp(-t * (1.5 + 1.2 * k))
    s *= 1 - np.exp(-t / .004)
    s[:1200] += bp(rng.standard_normal(1200), 700, 2800) * np.exp(-np.arange(1200) / 260) * .05
    return s * vel * .4

def build(c, ref_rms=None):
    reseed(c['seed'])
    SPB = 60 / c['bpm']; BARS = c['bars']; N = round(BARS * 4 * SPB * SR); PAD = 8 * SR
    sw = c.get('swing', .13)
    def swing(b): return b + sw if abs(b % 1 - 0.5) < 1e-6 else b
    def jitter(ms=7): return rng.normal(0, ms / 1000)
    epT, bsT, padT, gtT = (Track(N, PAD) for _ in range(4))
    kT, sT, hT = (Track(N, PAD) for _ in range(3))
    chords = c['chords']

    for ci, (root, voicing, _) in enumerate(chords):
        nxt = chords[(ci + 1) % len(chords)][0]
        base = ci * 8
        if c.get('ep', True):
            for bar in (0, 1):
                for pos, dur, vel in c['comp'][bar]:
                    t0 = (base + bar * 4 + swing(pos)) * SPB
                    for k, m in enumerate(voicing):
                        epT.add(t0 + k * 0.011 + abs(jitter()), ep(hz(m), dur * SPB, vel * rng.uniform(.88, 1.0) * (1.0 - .06 * k)))
        pad_notes = [hz(m - 12) for m in voicing[:3]] + [hz(root + 12)]
        padT.add(base * SPB, pad(pad_notes, 8 * SPB + 0.5))
        for pos, m, dur, vel in c['bass'](root, nxt):
            bsT.add((base + swing(pos)) * SPB + abs(jitter(5)), bass(hz(m), dur * SPB, vel))
        for bar in (0, 1) if 'gtr' in c else ():
            for pos, dur, vel, idx in c['gtr'][bar]:
                t0 = (base + bar * 4 + pos) * SPB
                for j, k in enumerate(idx):
                    gtT.add(t0 + j * 0.02 + abs(jitter(6)), pluck(hz(voicing[k]), dur * SPB, vel * rng.uniform(.85, 1.0)))

    style = c.get('drums')
    if style == 'lounge':
        for bar in range(2, BARS):
            b0 = bar * 4
            for pos, v in ((0, .85), (2.5, .5) if bar % 2 == 0 else (2.75, .45)):
                kT.add((b0 + swing(pos)) * SPB + jitter(6), kick(v * rng.uniform(.9, 1)))
            for pos in (1, 3):
                sT.add((b0 + pos) * SPB + jitter(8), brush(.5 * rng.uniform(.85, 1)))
        for step in range(2 * 8, BARS * 8):
            pos = step / 2
            hT.add(swing(pos) * SPB + jitter(5), hat((.42 if step % 2 else .24) * rng.uniform(.8, 1.0)))
    elif style == 'ballad':
        for bar in range(2, BARS):
            for pos in (1, 3):
                sT.add((bar * 4 + pos) * SPB + jitter(8), brush(.42 * rng.uniform(.85, 1)))
        for beat in range(2 * 4, BARS * 4):
            hT.add(beat * SPB + jitter(5), hat(.2 * rng.uniform(.8, 1.0)))
    elif style == 'bossa':
        for bar in range(2, BARS):
            b0 = bar * 4
            for pos, v in ((0, .5), (2, .38)):
                kT.add((b0 + pos) * SPB + jitter(6), kick(v * rng.uniform(.9, 1)))
            for pos in ((0, 1.5, 3) if bar % 2 == 0 else (1, 2)):
                sT.add((b0 + pos) * SPB + jitter(6), brush(.34 * rng.uniform(.85, 1)))
        for step in range(2 * 8, BARS * 8):
            hT.add(step / 2 * SPB + jitter(4), hat((.3 if step % 2 else .18) * rng.uniform(.8, 1.0)))

    def reverb(x, rt=c.get('rt', 2.4), damp=3800, pre=0.022):
        irs = []
        for _ in range(2):
            n = int(rt * 1.4 * SR); t = np.arange(n) / SR
            ir = lp(rng.standard_normal(n), damp) * np.exp(-t * 6.9 / rt)
            ir = np.concatenate([np.zeros(int(pre * SR)), ir])[:N]
            irs.append(ir / np.sqrt(np.sum(ir ** 2)))
        X = np.fft.rfft(x)
        return np.fft.irfft(X * np.fft.rfft(irs[0], N), N), np.fft.irfft(X * np.fft.rfft(irs[1], N), N)

    ep_m, bs_m, pad_m, gt_m = lp(epT.fold(), 2400), bsT.fold(), padT.fold(), gtT.fold()
    k_m, s_m, h_m = kT.fold(), sT.fold(), hT.fold()
    t = np.arange(N) / SR

    lfo = 0.28 * np.sin(TAU * t * max(1, round(BARS / 4)) / (N / SR))
    epL, epR = ep_m * (1 + lfo) * .75, ep_m * (1 - lfo) * .75
    padL, padR = pad_m * c.get('pad_gain', 1) , np.roll(pad_m, int(.017 * SR)) * c.get('pad_gain', 1)
    gtL, gtR = gt_m * .9, np.roll(gt_m, int(.009 * SR)) * .8
    bg = c.get('bass_gain', 1.0)

    dryL = epL + bs_m * .9 * bg + padL * .5 + k_m * .85 + s_m * .5 + h_m * .18 + gtL
    dryR = epR + bs_m * .9 * bg + padR * .5 + k_m * .85 + s_m * .5 + h_m * .27 + gtR

    send = ep_m * .5 + pad_m * c.get('pad_gain', 1) * .45 + s_m * .7 + h_m * .08 + gt_m * .35
    wetL, wetR = reverb(send)

    vinyl = np.zeros(N)
    for pos in rng.integers(0, N - 400, size=int(N / SR * 5.5)):
        a = rng.uniform(.015, .09) * rng.choice([-1, 1])
        vinyl[pos:pos + 120] += a * np.exp(-np.arange(120) / rng.uniform(4, 16))
    hiss = hp(lp(rng.standard_normal(N), 6500), 1800) * .0035
    vk = c.get('vinyl', 1.0)
    vinylL, vinylR = (vinyl + hiss) * .6 * vk, (np.roll(vinyl, 311) + np.roll(hiss, 977)) * .6 * vk

    L, R = dryL + wetL * .85 + vinylL, dryR + wetR * .85 + vinylR
    L, R = hp(L, 32), hp(R, 32)
    L, R = lp(L, c.get('lowpass', 11500), 1), lp(R, c.get('lowpass', 11500), 1)
    peak = max(np.abs(L).max(), np.abs(R).max())
    L, R = np.tanh(L / peak * 1.35) / np.tanh(1.35), np.tanh(R / peak * 1.35) / np.tanh(1.35)
    if ref_rms is None:
        gain = 0.5 / max(np.abs(L).max(), np.abs(R).max())
    else:
        gain = min(ref_rms / rms(np.concatenate([L, R])), .9 / max(np.abs(L).max(), np.abs(R).max()))
    return L * gain, R * gain, N

def lounge_bass(root, nxt):
    return [(0, root, 1.8, .9), (2.5, root + 7, .9, .6), (4, root, 1.4, .8), (6, root + 12, 1.0, .55), (7.5, nxt + (-1 if nxt > root else 1), .5, .55)]

SONGS = [
    dict(id='hubane-lounge', title='Hubane lounge', seed=1964, bpm=64, bars=16, drums='lounge', bass=lounge_bass,
         chords=[(41, [57, 60, 64, 67], 'Fmaj9'), (38, [53, 57, 60, 64], 'Dm9'), (43, [58, 62, 65, 69], 'Gm9'), (36, [52, 58, 62, 69], 'C13'),
                 (41, [57, 60, 64, 67], 'Fmaj9'), (45, [60, 64, 67, 71], 'Am9'), (46, [62, 65, 69, 72], 'Bbmaj7'), (36, [53, 58, 62, 67], 'C9sus')],
         comp=[[(0, 2.4, .85), (2.5, 1.3, .52)], [(1.0, 1.6, .6), (2.5, 1.4, .62)]]),
    dict(id='pehme-jazz', title='Pehme jazz', seed=3318, bpm=72, bars=18, drums='lounge', rt=2.2, vinyl=.7,
         bass=lambda r, n: [(0, r, .9, .85), (1, r + 7, .9, .55), (2, r + 12, .9, .55), (3, r + 7, .9, .5),
                            (4, r, .9, .75), (5, r + 7, .9, .5), (6, r + 12, .9, .5), (7, n + (-1 if n > r else 1), .9, .5)],
         chords=[(36, [55, 59, 62, 64], 'Cmaj9'), (45, [60, 64, 67, 71], 'Am9'), (38, [53, 57, 60, 64], 'Dm9'), (43, [53, 59, 64, 69], 'G13'),
                 (40, [55, 59, 62, 67], 'Em7'), (45, [55, 62, 64, 69], 'A7sus4'), (38, [53, 57, 60, 64], 'Dm9'), (43, [53, 59, 64, 69], 'G13'),
                 (36, [55, 59, 62, 64], 'Cmaj9')],
         comp=[[(0.5, 1.2, .6), (2, 1.5, .7)], [(0, 1.0, .58), (1.5, .9, .5), (3, .9, .55)]]),
    dict(id='ohtune-rahu', title='Õhtune rahu', seed=2207, bpm=48, bars=12, drums='ballad', rt=3.0, vinyl=.5, pad_gain=1.25,
         bass=lambda r, n: [(0, r, 3.8, .8), (4, r + 7, 3.4, .5)],
         chords=[(38, [53, 57, 60, 64], 'Dm9'), (46, [62, 65, 69, 72], 'Bbmaj9'), (43, [58, 62, 65, 69], 'Gm9'),
                 (45, [55, 60, 64, 67], 'Am7'), (46, [62, 65, 69, 72], 'Bbmaj9'), (45, [55, 62, 64, 69], 'A7sus4')],
         comp=[[(0, 3.6, .66), (2.5, 1.4, .36)], [(1.0, 2.5, .46)]]),
    dict(id='kitarriohtu', title='Kitarriõhtu', seed=1531, bpm=56, bars=14, swing=0, ep=False, rt=2.6, vinyl=.3, pad_gain=1.1,
         bass=lambda r, n: [(0, r, 3.4, .7), (4, r + 7, 3.2, .45)],
         chords=[(45, [61, 64, 68, 71], 'Amaj9'), (42, [57, 61, 64, 66], 'F#m7'), (38, [61, 64, 66, 69], 'Dmaj9'), (47, [62, 66, 69, 71], 'Bm7'),
                 (40, [59, 62, 64, 69], 'E7sus4'), (38, [61, 64, 66, 69], 'Dmaj9'), (40, [59, 62, 64, 69], 'E7sus4')],
         gtr=[[(i / 2, 2.0, .6 if i % 4 == 0 else .42, [k]) for i, k in enumerate([0, 2, 1, 3, 2, 3, 1, 2])],
              [(i / 2, 2.0, .58 if i % 4 == 0 else .4, [k]) for i, k in enumerate([0, 1, 2, 3, 2, 1, 3, 2])]]),
    dict(id='puhapaeva-hommik', title='Pühapäeva hommik', seed=808, bpm=80, bars=20, swing=0, ep=False, drums='bossa', rt=1.9, vinyl=.4, pad_gain=.7,
         bass=lambda r, n: [(0, r, 1.2, .85), (1.5, r + 7, .8, .55), (4, r, 1.2, .8), (5.5, r + 7, .8, .5), (7, r + 12, .7, .45)],
         chords=[(43, [59, 62, 66, 69], 'Gmaj9'), (40, [55, 59, 62, 66], 'Em9'), (45, [60, 64, 67, 71], 'Am9'), (38, [60, 64, 66, 69], 'D13'),
                 (43, [59, 62, 66, 69], 'Gmaj9'), (47, [57, 62, 66, 69], 'Bm7'), (40, [55, 59, 62, 66], 'Em9'), (48, [59, 62, 64, 67], 'Cmaj9'),
                 (45, [60, 64, 67, 71], 'Am9'), (38, [60, 64, 66, 69], 'D13')],
         gtr=[[(0, 2.0, .8, [0, 1, 2, 3]), (1.5, 1.5, .5, [2, 3]), (3, 1.0, .45, [1, 2, 3])],
              [(0, 1.5, .7, [0, 1, 2, 3]), (1.5, 1.0, .5, [2, 3]), (2.5, 1.5, .55, [1, 2, 3])]]),
]

if __name__ == '__main__':
    dst = pathlib.Path('public/audio'); dst.mkdir(parents=True, exist_ok=True)
    ref = None
    for song in SONGS:
        L, R, N = build(song, ref)
        if ref is None: ref = rms(np.concatenate([L, R]))
        pcm = (np.stack([L, R], 1) * 32767).astype('<i2')
        with tempfile.TemporaryDirectory() as tmp:
            wav = pathlib.Path(tmp) / 'x.wav'
            with wave.open(str(wav), 'wb') as w:
                w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-codec:a', 'libmp3lame', '-q:a', '4',
                            '-metadata', f"title={song['title']} (silmus)", str(dst / f"{song['id']}.mp3")], check=True)
        print('OK', song['id'], f'{N / SR:.3f} s', 'peak', round(float(np.abs(pcm).max() / 32767), 2))
