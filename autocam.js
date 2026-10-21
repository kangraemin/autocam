// 무인 캠 핵심 규칙 — py/autocam.py 와 같은 계산(무리 중심 목표 → 부드러운 카메라).
const AC = {};
AC.params = { conf: 0.35, det_step: 3, sigma: 0.12, crop_w: 0.5, alpha: 0.08, deadzone: 0.04,
  gain: 2.5, vmax: 0.5, amax: 1.5, lookahead: 0.7, headroom: 0 };
// 종목 프리셋(같은 시험 영상으로 고른 값이라 독립 검증 아님)
AC.presets = { futsal: { crop_w: 0.6, headroom: 0 }, basketball: { crop_w: 0.6, headroom: 0 }, volleyball: { crop_w: 0.75, headroom: 0.35 } };

AC.inside = (poly, x, y) => {
  if (!poly || poly.length < 3) return true;
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
};

// dets: 검출 프레임 인덱스별 [[x1,y1,x2,y2,score],...] (det_step 간격으로만 채워짐)
AC.targets = (dets, n, W, H, fps, roi, p = AC.params) => {
  const T = new Array(n); const used = new Array(n);
  let prev = null, cur = [W / 2, H / 2]; const sig = p.sigma * W;
  for (let i = 0; i < n; i++) {
    if (i % p.det_step === 0 && dets[i]) {
      const ps = dets[i].filter(d => d[4] >= p.conf && (d[3] - d[1]) > 0.025 * H && AC.inside(roi, (d[0] + d[2]) / 2, d[3]));
      used[i] = ps;
      if (ps.length) {
        const foot = ps.map(d => [(d[0] + d[2]) / 2, d[3]]);
        const ctr = ps.map(d => [(d[0] + d[2]) / 2, (d[1] + d[3]) / 2]);
        let sw = 0, sx = 0, sy = 0;
        ps.forEach((_, a) => {
          let dens = 0;
          foot.forEach(f => { const dx = foot[a][0] - f[0], dy = foot[a][1] - f[1]; dens += Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); });
          let spd = 0;
          if (prev && prev.length) {
            let m = Infinity;
            prev.forEach(q => { m = Math.min(m, Math.hypot(foot[a][0] - q[0], foot[a][1] - q[1])); });
            spd = m < 0.08 * W ? m / (p.det_step / fps) / W : 0;
          }
          const w = dens * (0.5 + Math.min(spd / 0.1, 2));
          sw += w; sx += w * ctr[a][0]; sy += w * ctr[a][1];
        });
        cur = [sx / sw, sy / sw]; prev = foot;
      } else prev = null;
    } else used[i] = i ? used[i - 1] : [];
    T[i] = cur.slice();
  }
  return { T, used };
};

// 실시간 모드 look=0, 녹화본 후처리 모드 look=p.lookahead(초)
AC.camera = (T, W, H, fps, look = 0, p = AC.params) => {
  const n = T.length, L = Math.round(look * fps);
  const cw = p.crop_w * W, ch = cw * 9 / 16, dt = 1 / fps, hr = (p.headroom || 0) * ch;
  const TT = (L ? T.slice(L).concat(Array(L).fill(T[n - 1])) : T).map(t => [t[0], t[1] - hr]);
  let ts = TT[0].slice(), cam = TT[0].slice(), v = [0, 0]; const out = new Array(n);
  const dz = p.deadzone * W, vm = p.vmax * W, am = p.amax * W * dt;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      ts[k] += p.alpha * (TT[i][k] - ts[k]);
      let e = ts[k] - cam[k];
      e = Math.abs(e) < dz ? 0 : e - Math.sign(e) * dz;
      const vd = Math.max(-vm, Math.min(vm, e * p.gain));
      v[k] += Math.max(-am, Math.min(am, vd - v[k]));
      cam[k] += v[k] * dt;
    }
    cam[0] = Math.max(cw / 2, Math.min(W - cw / 2, cam[0]));
    cam[1] = Math.max(ch / 2, Math.min(H - ch / 2, cam[1]));
    out[i] = cam.slice();
  }
  return { cam: out, cw, ch };
};

// 자동 득점 후보: 무리 중심이 골대 점 근처로 빠르게 들어오는 순간 (정확도 미검증 — 후보일 뿐)
AC.goalCandidates = (T, fps, goals, W, cooldown = 20) => {
  const out = []; let last = -1e9; const step = Math.round(fps / 2);
  if (!goals || !goals.length) return out;
  for (let i = step; i < T.length; i += step) {
    const spd = Math.hypot(T[i][0] - T[i - step][0], T[i][1] - T[i - step][1]) / 0.5 / W;
    for (const g of goals) {
      const d = Math.hypot(T[i][0] - g[0], T[i][1] - g[1]) / W;
      const d0 = Math.hypot(T[i - step][0] - g[0], T[i - step][1] - g[1]) / W;
      if (d < 0.15 && d0 > d && spd > 0.12 && i / fps - last > cooldown) { out.push(i / fps); last = i / fps; }
    }
  }
  return out;
};

if (typeof module !== 'undefined') module.exports = AC;
