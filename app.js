(() => {
  const audio = document.querySelector('#audio');
  const playButton = document.querySelector('#play-button');
  const playGlyph = playButton.querySelector('span');
  const restartButton = document.querySelector('#restart-button');
  const muteButton = document.querySelector('#mute-button');
  const volume = document.querySelector('#volume');
  const seekbar = document.querySelector('#seekbar');
  const currentTime = document.querySelector('#current-time');
  const totalTime = document.querySelector('#total-time');
  const visualTime = document.querySelector('#visual-time');
  const visualizer = document.querySelector('#visualizer');
  const playerCard = document.querySelector('#player-card');
  const lyricsContainer = document.querySelector('#lyrics-container');
  const lyricsState = document.querySelector('#lyrics-state');
  const cursorGlow = document.querySelector('.cursor-glow');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let rows = [];
  let rafId;
  let audioContext;
  let analyser;
  let source;
  let dataArray;
  let lastActiveLine;
  const SOURCE_OFFSET = 60;
  const CLIP_START = 0;
  const CLIP_END = 63;
  const CLIP_DURATION = CLIP_END - CLIP_START;
  const LYRIC_DELAY = 0.25;

  function clipPosition() {
    return Math.max(0, Math.min(CLIP_DURATION, audio.currentTime - CLIP_START));
  }

  function clipEnvelope() {
    const progress = clipPosition() / CLIP_DURATION;
    if (progress < .28) return .22 + (progress / .28) * .78;
    if (progress > .78) return .22 + ((1 - progress) / .22) * .78;
    return 1;
  }

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const parseTime = (value) => {
    if (!value) return 0;
    const parts = value.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return Number(value) || 0;
  };

  function setupAudioGraph() {
    if (audioContext) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = .78;
    source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  async function togglePlay() {
    setupAudioGraph();
    if (audioContext?.state === 'suspended') await audioContext.resume();
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  }

  function updatePlayState() {
    const playing = !audio.paused;
    document.body.classList.toggle('is-playing', playing);
    playGlyph.textContent = playing ? 'Ⅱ' : '▶';
    playButton.setAttribute('aria-label', playing ? 'Pause track' : 'Play track');
    lyricsState.textContent = playing ? 'PLAYING / LIVE SYNC' : 'PAUSED / PRESS PLAY';
    playerCard.classList.toggle('playing', playing);
    if (playing && !rafId) drawVisualizer();
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = visualizer.getBoundingClientRect();
    visualizer.width = rect.width * ratio;
    visualizer.height = rect.height * ratio;
    const ctx = visualizer.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function drawVisualizer() {
    rafId = requestAnimationFrame(drawVisualizer);
    const ctx = visualizer.getContext('2d');
    const width = visualizer.clientWidth;
    const height = visualizer.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const bars = 40;
    const energy = clipEnvelope();
    const gap = 4;
    const barWidth = (width - gap * (bars - 1)) / bars;
    let values = [];
    if (analyser) {
      analyser.getByteFrequencyData(dataArray);
      values = Array.from({ length: bars }, (_, i) => dataArray[Math.min(dataArray.length - 1, Math.floor(i / bars * dataArray.length))] / 255);
    } else {
      values = Array.from({ length: bars }, (_, i) => .18 + Math.abs(Math.sin(Date.now() / 640 + i * .4)) * .12);
    }
    values.forEach((value, i) => {
      const x = i * (barWidth + gap);
      const barHeight = Math.max(5, value * height * (.3 + energy * .62));
      const y = (height - barHeight) / 2;
      const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
      gradient.addColorStop(0, '#d7ff3f');
      gradient.addColorStop(1, '#9b70ff');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);
    });
    if (!audio.paused && !prefersReduced) {
      const glow = ctx.createRadialGradient(width * .5, height * .5, 4, width * .5, height * .5, height * .62);
      glow.addColorStop(0, `rgba(215,255,63,${.05 + energy * .18})`);
      glow.addColorStop(1, 'rgba(215,255,63,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }
  }

  function renderLyrics(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Invalid TTML');
    const ns = 'http://www.w3.org/ns/ttml';
    const paragraphs = [...xml.getElementsByTagNameNS(ns, 'p')]
      .filter((p) => parseTime(p.getAttribute('end')) > SOURCE_OFFSET + CLIP_START && parseTime(p.getAttribute('begin')) < SOURCE_OFFSET + CLIP_END);
    lyricsContainer.innerHTML = '';
    rows = paragraphs.map((p) => {
      const line = document.createElement('p');
      line.className = 'lyric-line';
      const words = [...p.getElementsByTagNameNS(ns, 'span')].map((span) => {
        const wordEl = document.createElement('span');
        wordEl.className = 'lyric-word';
        wordEl.textContent = `${span.textContent} `;
        line.appendChild(wordEl);
        return { el: wordEl, start: parseTime(span.getAttribute('begin')) - SOURCE_OFFSET + LYRIC_DELAY, end: parseTime(span.getAttribute('end')) - SOURCE_OFFSET + LYRIC_DELAY };
      });
      lyricsContainer.appendChild(line);
      return { line, start: parseTime(p.getAttribute('begin')) - SOURCE_OFFSET + LYRIC_DELAY, end: parseTime(p.getAttribute('end')) - SOURCE_OFFSET + LYRIC_DELAY, words };
    });
    lyricsState.textContent = `${rows.length} LINES / READY WHEN YOU ARE`;
  }

  function syncLyrics() {
    const now = audio.currentTime;
    let activeRow;
    rows.forEach((row) => {
      const isActive = now >= row.start && now < row.end;
      row.line.classList.toggle('active', isActive);
      if (isActive) activeRow = row;
      row.words.forEach((word) => {
        word.el.classList.toggle('active', now >= word.start && now < word.end);
        word.el.classList.toggle('done', now >= word.end);
      });
    });
    if (activeRow && activeRow.line !== lastActiveLine) {
      activeRow.line.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
      lastActiveLine = activeRow.line;
    }
  }

  playButton.addEventListener('click', togglePlay);
  document.querySelectorAll('.js-play').forEach((button) => button.addEventListener('click', () => { togglePlay(); document.querySelector('#listen').scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' }); }));
  restartButton.addEventListener('click', () => { audio.currentTime = 0; if (audio.paused) togglePlay(); });
  muteButton.addEventListener('click', () => { audio.muted = !audio.muted; muteButton.textContent = audio.muted ? '○' : '◖'; });
  volume.addEventListener('input', () => { audio.volume = Number(volume.value); audio.muted = audio.volume === 0; });
  seekbar.addEventListener('input', () => { audio.currentTime = CLIP_START + (Number(seekbar.value) / 100) * CLIP_DURATION; });
  audio.addEventListener('play', () => { if (audio.currentTime < CLIP_START) audio.currentTime = CLIP_START; updatePlayState(); });
  audio.addEventListener('pause', updatePlayState);
  audio.addEventListener('ended', () => { audio.currentTime = CLIP_START; updatePlayState(); });
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = CLIP_START; totalTime.textContent = formatTime(CLIP_DURATION); });
  audio.addEventListener('timeupdate', () => {
    if (audio.currentTime < CLIP_START) audio.currentTime = CLIP_START;
    if (audio.currentTime >= CLIP_END) { audio.pause(); audio.currentTime = CLIP_START; }
    const elapsed = clipPosition();
    const ratio = elapsed / CLIP_DURATION;
    seekbar.value = ratio * 100;
    currentTime.textContent = formatTime(elapsed);
    visualTime.textContent = formatTime(elapsed);
    syncLyrics();
  });
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  drawVisualizer();
  audio.volume = Number(volume.value);

  fetch('/lyrics/SKY2.karaoke.ttml').then((response) => response.text()).then(renderLyrics).catch(() => { lyricsContainer.innerHTML = '<p class="lyrics-loading">Lyrics are taking the night off.</p>'; });

  const revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObserver.unobserve(entry.target); } }), { threshold: .12 });
  document.querySelectorAll('.reveal').forEach((element, index) => { element.style.transitionDelay = `${Math.min(index * 35, 280)}ms`; revealObserver.observe(element); });

  if (!prefersReduced) {
    window.addEventListener('pointermove', (event) => { cursorGlow.style.left = `${event.clientX}px`; cursorGlow.style.top = `${event.clientY}px`; });
    document.querySelectorAll('[data-tilt]').forEach((card) => card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - .5;
      const y = (event.clientY - rect.top) / rect.height - .5;
      card.querySelector('.cover-frame').style.transform = `rotate(${7 + x * 7}deg) rotateX(${y * -5}deg) rotateY(${x * 5}deg)`;
    }));
    document.querySelectorAll('[data-tilt]').forEach((card) => card.addEventListener('pointerleave', () => { card.querySelector('.cover-frame').style.transform = ''; }));
  }

})();
