(function() { // PROTECTION IIFE - Rend inaccessibles les variables globales de l'app 
/* ═══════════════════════════════════════════════
   ÉTAT
═══════════════════════════════════════════════ */
var S = {
  name:'Étudiant', id:'', submitted:false, submitTime:null,
  log:[], paste:0, copy:0, tabs:0, focus:0, screenshots:0,
  photos:0, absentMs:0,
  t0:Date.now(),
  startWall: new Date().toLocaleString('fr-CA'),
  wc:0, cc:0, photoCount:0,
  consigne:''
};
var _absentStart = null;
var _apReady = false;  /* true après le délai de 4s */
var _photos      = [];    /* {time, reason, dataUrl, screenUrls} — en mémoire seulement */
var _camStream   = null;
var _screenStreams = [];   /* tableau de MediaStream (un par écran partagé) */
var _isPaused    = false;
var _pauseTimer  = null;
var _pauseTimeleft = 300; // 5 min en sec
var _monitoringActive = false; // Flag de santé du moteur de surveillance
var _screenCount  = 1;    /* nombre d'écrans déclarés par l'étudiant */
var _screenEnabled = false; /* true si enableScreenCapture activé et consenti */
var ed = document.getElementById('ed');

/* ═══════════════════════════════════════════════
   SON — auto-init sur premier geste
═══════════════════════════════════════════════ */
var _ac=null, _snd=false;
function initSound(){
  if(_snd) return;
  try{
    _ac=new(window.AudioContext||window.webkitAudioContext)();
    _snd=true;
    var si=document.getElementById('snd-status');
    si.innerHTML='<span class="hst-dot"></span>Son actif'; si.className='hst on';
    _bip(880,0,.06,.1,'sine');
  }catch(e){
    var _si=document.getElementById('snd-status');_si.innerHTML='<span class="hst-dot"></span>Son indisponible';_si.className='hst';
  }
}
['click','keydown','touchstart'].forEach(function(ev){
  document.addEventListener(ev,function h(){ initSound();
    document.removeEventListener(ev,h);},{once:true});
});
function _bip(f,t,d,v,w){
  if(!_snd||!_ac) return;
  if(_ac.state==='suspended') _ac.resume();
  try{
    var o=_ac.createOscillator(),g=_ac.createGain();
    o.connect(g);g.connect(_ac.destination);
    o.type=w||'square';
    o.frequency.setValueAtTime(f,_ac.currentTime+t);
    g.gain.setValueAtTime(0,_ac.currentTime+t);
    g.gain.linearRampToValueAtTime(v||.3,_ac.currentTime+t+.01);
    g.gain.exponentialRampToValueAtTime(.0001,_ac.currentTime+t+d);
    o.start(_ac.currentTime+t);o.stop(_ac.currentTime+t+d+.04);
  }catch(e){}
}
function playAlert(type){
  if(!_snd || !_ac) return;
  // Forcer la reprise du contexte audio si suspendu (nécessaire sur bcp de navigateurs)
  if(_ac.state === 'suspended') {
    _ac.resume().then(() => playAlert(type));
    return;
  }
  if(type==='leave'){_bip(880,0,.14,.5,'square');_bip(660,.18,.14,.5,'square');_bip(440,.36,.22,.5,'square');}
  else if(type==='blocked'){_bip(200,0,.15,.5,'sawtooth');_bip(160,.18,.18,.5,'sawtooth');}
  else if(type==='submit'){_bip(523,0,.10,.2,'sine');_bip(659,.13,.10,.2,'sine');_bip(784,.26,.15,.2,'sine');_bip(1047,.43,.22,.18,'sine');}
  else if(type==='save'){_bip(880,0,.08,.14,'sine');}
  else if(type==='check'){_bip(660,0,.08,.16,'sine');_bip(880,.12,.08,.13,'sine');}
  else if(type==='photo'){_bip(1200,0,.05,.12,'sine');_bip(1000,.07,.05,.1,'sine');}
}

/* ═══════════════════════════════════════════════
   CAMÉRA — getUserMedia
   Photos prises au démarrage, au retour d'absence,
   sur soumission et toutes les 8-12 minutes.
═══════════════════════════════════════════════ */
function initCamera(){
  if(!navigator||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    setCamStatus(false,'Non supportée');return;
  }
  navigator.mediaDevices.getUserMedia({video:{width:120,height:90,facingMode:'user'},audio:false})
    .then(function(stream){
      _camStream=stream;
      var v=document.getElementById('cam-video');
      v.srcObject=stream;
      v.play();
      setCamStatus(true,'');
      log('CAMÉRA','Surveillance visuelle activée.','i');
      /* Premier cliché après 2s */
      setTimeout(function(){ capturePhoto('Début examen — identification'); },2000);
      scheduleRandCapture();
    })
    .catch(function(e){
      setCamStatus(false,'Accès refusé');
      log('CAMÉRA','Accès caméra refusé : '+e.message+'. L\'évaluation continue sans surveillance visuelle.','w');
      document.getElementById('cam-placeholder').textContent='📷 Caméra non disponible';
      updLog();
    });
}

function setCamStatus(ok,msg){
  var el=document.getElementById('cam-status');
  if(ok){ el.innerHTML='<span class="hst-dot"></span>Caméra active'; el.className='hst on'; }
  else  { el.innerHTML='<span class="hst-dot"></span>'+msg; el.className='hst off'; }
}

async function capturePhoto(reason) {
  if (!_camStream) return;
  var v = document.getElementById('cam-video');
  var c = document.getElementById('cam-canvas');
  try {
    // S'assurer que le flux est actif et "joue" pour éviter les frames noires sur certains navigateurs (Mac/Safari)
    if (v.paused) await v.play().catch(() => {});
    
    // Un léger délai permet au pipeline de rendu du navigateur de produire un frame réel,
    // surtout si l'onglet était en arrière-plan ou l'élément hors-champ.
    await new Promise(r => setTimeout(r, 150));

    var ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, 120, 90);
    var camData = c.toDataURL('image/jpeg', 0.25);
    var n = new Date();
    var t = pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
    
    var screens = [];
    if (_screenEnabled && _screenStreams && _screenStreams.length > 0) {
      for (var i = 0; i < _screenStreams.length; i++) {
        if (_screenStreams[i].active) {
          var sData = await captureScreenStream(_screenStreams[i]);
          if (sData) screens.push(sData);
        }
      }
    }

    _photos.push({ time: t, reason: reason, dataUrl: camData, screens: screens });
    if (_photos.length > 12) _photos.shift();
    S.photoCount = _photos.length;
    if (!reason.includes('Capture')) S.photos++;
    playAlert('photo');
    log(reason.includes('Capture') ? 'CAPTURE' : 'PHOTO', 'Prise : ' + reason, 'photo');
    renderPhotoGallery();
    updSub();
  } catch (e) { console.error("Erreur capturePhoto:", e); }
}

async function captureScreenStream(stream) {
  return new Promise((resolve) => {
    var v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.srcObject = stream;
    
    var timeout = setTimeout(() => { resolve(null); }, 2500);

    v.onloadeddata = function() {
      v.play().catch(function(){}); // Tenter de forcer la lecture
      // Délai pour s'assurer que le premier frame réel est décodé et prêt
      setTimeout(function() {
        clearTimeout(timeout);
        try {
          var c = document.getElementById('screen-canvas');
          if(!c) return resolve(null);
          c.width = 320; 
          c.height = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * 320)) || 180;
          var ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.4));
        } catch(err) {
          resolve(null);
        }
      }, 150);
    };
    v.onerror = function() { resolve(null); };
  });
}

function scheduleRandCapture(){
  var delay=(8+Math.random()*5)*60*1000; /* 8-13 minutes */
  setTimeout(function(){
    if(!S.submitted){ capturePhoto('Vérification aléatoire'); scheduleRandCapture(); }
  },delay);
}

function renderPhotoGallery(){
  var grid=document.getElementById('photo-grid');
  if(!_photos.length){ grid.innerHTML='<div id="cam-placeholder">Aucune photo encore.</div>'; return; }
  var h='';
  _photos.forEach(function(p){
    h+='<div class="photo-thumb"><img src="'+p.dataUrl+'" alt="photo">';
    if(p.screens && p.screens.length > 0){
      p.screens.forEach(function(s, idx){
        h+='<img src="'+s+'" alt="ecran" class="screen-thumb" title="Écran '+(idx+1)+'">';
      });
    }
    h+='<span>'+esc(p.time)+'<br>'+esc(p.reason.substring(0,18))+'</span></div>';
  });
  grid.innerHTML=h;
  grid.scrollTop=grid.scrollHeight;
}

/* ═══════════════════════════════════════════════
   SESSION — page blanche au démarrage
   On utilise sessionStorage pour détecter si c'est
   une vraie reprise (même onglet) ou une nouvelle
   session (nouvel onglet / nouvelle fenêtre).
═══════════════════════════════════════════════ */
var _sessKey='';
function isResume(){
  /* sessionStorage est propre à chaque onglet/fenêtre */
  try{
    _sessKey='exam_sess_'+(S.id||'anon');
    return !!sessionStorage.getItem(_sessKey);
  }catch(e){ return false; }
}
function markSession(){
  try{ sessionStorage.setItem(_sessKey,'1'); }catch(e){}
}

/* ═══════════════════════════════════════════════
   PLEIN ÉCRAN
═══════════════════════════════════════════════ */
function toggleFS(){
  var btn=document.getElementById('btn-fs');
  if(!document.fullscreenElement){
    document.documentElement.requestFullscreen().catch(function(){
      showToast('Plein écran non autorisé par ce navigateur.');
    });
    btn.textContent='✕ Quitter plein écran';
  }else{
    document.exitFullscreen();
    btn.textContent='⛶ Plein écran';
  }
}
document.addEventListener('fullscreenchange',function(){
  if(!document.fullscreenElement)
    document.getElementById('btn-fs').textContent='⛶ Plein écran';
});

/* ═══════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════ */
window.addEventListener('load', function() {
  /* 1. Initialisation SCORM */
  const isSCORM = SCORM.init();
  
  /* 2. Écouter le chargement de la config - UNE SEULE FOIS */
  window.addEventListener('scorm_config_ready', function(e) {
    const config = e.detail;
    applyConfig(config);
    setupApp(isSCORM);
    setupAP();
    startHeartbeat();
    setupTypingStats();
    initTimeline();
    initDynamicResources();
  });
});

function applyConfig(config) {
  if (!config) return;
  if (config.appName) {
    document.title = config.appName;
    var h1 = document.querySelector('#welcome h1');
    if (h1) h1.textContent = '📝 ' + config.appName;
  }
  /* Activer les éléments de capture d'écran si configuré */
  if (config.security && config.security.enableScreenCapture) {
    _screenEnabled = true;
    var ruleScreen = document.getElementById('wc-rule-screen');
    var step3 = document.getElementById('cl-step3');
    if (ruleScreen) ruleScreen.style.display = '';
    if (step3) step3.style.display = 'flex';
  }
  if(config.pedagogy && config.pedagogy.authorizedPauseDuration > 0) {
    var btnP = document.getElementById('btn-pause');
    if(btnP) btnP.style.display = 'inline-flex';
    _pauseTimeleft = Math.floor(config.pedagogy.authorizedPauseDuration / 1000);
  }
  
  // Backup auto toutes les X min
  if(config.security && config.security.autoDownloadInterval > 0){
    setInterval(function(){
      if(!S.submitted && _apReady && !_isPaused) {
        manualSave(true); // true pour mode silencieux
      }
    }, config.security.autoDownloadInterval);
  }
}

function setupApp(isSCORM) {
  const isStandalone = SCORM.isStandalone();
  const belt = document.getElementById('status-belt');
  const sText = document.querySelector('.status-text');
  const sDot = document.querySelector('.status-dot');
  const sMode = document.getElementById('status-mode');
  const config = SCORM.getConfig();

  if (belt) belt.style.display = 'flex';
  
  if (isStandalone) {
    if (sText) sText.textContent = "Mode local / Démo";
    if (sDot) sDot.style.background = "#3498db";
    if (sMode) {
      sMode.textContent = "GITHUB PAGES";
      sMode.style.display = "inline-block";
    }
    showToast(config.messages.demoModeActive || "Mode Démo actif");
  } else {
    if (sText) sText.textContent = "Connecté à Moodle";
    if (sDot) sDot.style.background = "#2ecc71";
    if (sMode) {
      sMode.textContent = "SCORM 1.2";
      sMode.style.display = "inline-block";
    }
  }

  S.name = SCORM.getStudentName();
  S.id = SCORM.getStudentId();
  var hdrN = document.getElementById('hdr-user-name');
  if (hdrN) hdrN.textContent = '👤 ' + S.name;
  updWelcomeName(S.name);
  _sessKey = 'exam_sess_' + (S.id || 'anon');

  var sv = SCORM.load();
  var resume = isResume();

  if (sv) {
    S.log         = sv.log || [];
    S.paste       = sv.paste || 0;
    S.copy        = sv.copy || 0;
    S.tabs        = sv.tabs || 0;
    S.focus       = sv.focus || 0;
    S.screenshots = sv.screenshots || 0;
    S.absentMs    = sv.absentMs || 0;
    if (sv.submitted) { S.submitted = true; S.submitTime = sv.submitTime; }

    if (resume && sv.text) {
      ed.innerHTML = sv.text;
      if (sv._fromLocal) showRecoveryBanner();
    } else if (!resume && !S.submitted) {
      showToast('Nouvelle session — éditeur vide.');
      markSession();
    }
    if (sv.t0) S.t0 = sv.t0;
    if (sv.consigne) {
      S.consigne = sv.consigne;
      renderConsigne();
    }
  }
}

var _charCount = 0;
var _typingInterval = null;

function setupTypingStats() {
  const ed = document.getElementById('ed');
  const config = SCORM.getConfig();
  if (!ed || !config) return;
  const limit = config.security.typingSpeedLimit || 500;

  ed.addEventListener('input', function(e) {
    _charCount++;
    if (!_typingInterval) {
      _typingInterval = setInterval(function() {
        if (_charCount > limit) {
          log('ALERTE SAISIE', 'Vitesse de saisie suspecte : ' + _charCount + ' car/s', 'w');
          showToast(config.messages.suspiciousTyping || "Saisie suspecte !");
          playAlert('leave');
        }
        _charCount = 0;
      }, 1000);
    }
  });
}

function startHeartbeat() {
  const config = SCORM.getConfig();
  if (!config) return;
  const interval = config.security.heartbeatInterval || 5000;
  
  setInterval(function() {
    if (SCORM.isStandalone()) return;
    
    const sDot = document.querySelector('.status-dot');
    const sText = document.querySelector('.status-text');
    const status = SCORM.get('cmi.core.lesson_status');
    
    if (status === "" && !SCORM.isStandalone()) {
      const isOk = SCORM.init();
      if (isOk === false) {
        if (sDot) sDot.style.background = "#e74c3c";
        if (sText) sText.textContent = "CONNEXION PERDUE";
        showToast(config.messages.connectionLost);
      } else {
        if (sDot) sDot.style.background = "#2ecc71";
        if (sText) sText.textContent = "Connecté à Moodle";
      }
    } else if (!SCORM.isStandalone()) {
      if (sDot) sDot.style.background = "#2ecc71";
      if (sText) sText.textContent = "Connecté à Moodle";
    }
  }, interval);
}

function initTimeline() {
  const config = SCORM.getConfig();
  if (!config || !config.pedagogy.enableTimeline) return;
  if (!S.timeline) S.timeline = [];
  
  setInterval(function() {
    if (S.submitted || !_apReady) return;
    const ed = document.getElementById('ed');
    if (!ed) return;
    const txt = ed.innerHTML;
    const last = S.timeline[S.timeline.length - 1];
    
    if (!last || last.text !== txt) {
      S.timeline.push({ ts: Date.now(), text: txt });
      if (S.timeline.length > 30) S.timeline.shift();
    }
  }, config.pedagogy.timelineSnapshotInterval || 60000);
}

function initDynamicResources() {
  const config = SCORM.getConfig();
  if (!config || !config.pedagogy.allowedResources) return;
  
  RURL = {}; 
  const container = document.getElementById('res-cards-container');
  if (!container) return;
  container.innerHTML = '';

  config.pedagogy.allowedResources.forEach((res, idx) => {
    const id = res.id || 'res_' + idx;
    RURL[id] = { label: res.title, url: res.url };
    if (!_resStat[id]) _resStat[id] = { visits: 0, totalMs: 0, lastOpen: null };
    
    const card = document.createElement('div');
    card.className = 'res-card';
    card.onclick = () => openRes(id);
    
    let iconSvg = '';
    if (res.icon === 'book') {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>';
    } else if (res.icon === 'edit-3') {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    } else {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    }

    card.innerHTML = `
      <div class="res-card-hdr">
        <div class="res-card-icon">${iconSvg}</div>
        <div class="res-card-info">
          <div class="res-card-title">${res.title}</div>
          <div class="res-card-author">${res.author || ''}</div>
        </div>
      </div>
      <div class="res-card-desc">${res.description || ''}</div>
      <div class="res-card-footer">
        <div class="res-logged-tag">
          <svg style="width:10px;height:10px" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Journalisé
        </div>
        <button class="res-open-btn">
          <span>Ouvrir</span>
          <svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function checkAIPatterns(text) {
  const plain = text.replace(/<[^>]+>/g, ' ').trim();
  if (plain.length < 500) return;
  
  const words = plain.split(/\s+/).length;
  const punctuation = (plain.match(/[.,!?;:]/g) || []).length;
  
  if (words > 100 && (punctuation / words) < 0.05) {
    log('PÉDAGOGIE', 'Analyse : Structure de phrase potentiellement artificielle détectée.', 'i');
  }
}

/* ═══════════════════════════════════════════════
   HORLOGE + TEMPS D'ABSENCE
═══════════════════════════════════════════════ */
var _cs='00:00';
var _wallClock='';
function startClock(){
  function tick(){
    /* Chrono de session */
    var s=Math.floor((Date.now()-S.t0)/1000);
    _cs=pad(Math.floor(s/60))+':'+pad(s%60);
    document.getElementById('sb-time').textContent='⏱ '+_cs;
    document.getElementById('si-dur').textContent=_cs;
    /* Heure réelle */
    var now=new Date();
    _wallClock=pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
    var wce=document.getElementById('wall-clock');
    if(wce) wce.textContent=_wallClock;
    /* Temps absent */
    var ab=S.absentMs+(_absentStart?Date.now()-_absentStart:0);
    var as=Math.floor(ab/1000);
    var absStr=as<60?as+'s':pad(Math.floor(as/60))+':'+pad(as%60);
    document.getElementById('sc-abs').textContent=absStr;
    document.getElementById('si-abs').textContent=absStr;
    if(_absentStart){
      document.getElementById('sb-absent').style.display='inline';
      document.getElementById('sb-absent').textContent='⚠ Absent : '+absStr;
    }else{
      document.getElementById('sb-absent').style.display='none';
    }
  }
  tick();
  setInterval(tick,1000);
}
function pad(n){return String(n).padStart(2,'0');}
function absentStr(){
  var as=Math.floor(S.absentMs/1000);
  return as<60?as+'s':pad(Math.floor(as/60))+':'+pad(as%60);
}

/* ═══════════════════════════════════════════════
   SAUVEGARDE
═══════════════════════════════════════════════ */
function build(){
  return{v:5,text:ed.innerHTML,log:S.log.slice(-20),
    paste:S.paste,copy:S.copy,tabs:S.tabs,focus:S.focus,
    screenshots:S.screenshots,absentMs:S.absentMs,
    submitted:S.submitted,
    submitTime:S.submitTime,wc:S.wc, timeline: S.timeline,
    t0: S.t0, consigne: S.consigne};
}
function autoSave(){
  if(S.submitted)return;
  setSave('saving');
  try{
    const obj = build();
    checkAIPatterns(obj.text);
    SCORM.save(obj);
    setSave('saved');
  }
  catch(e){ setSave('unsaved'); }
}
function showRecoveryBanner(){
  document.getElementById('recovery-banner').style.display='block';
  setTimeout(function(){
    document.getElementById('recovery-banner').style.display='none';
  },12000);
}

/* ═══════════════════════════════════════════════
   SAUVEGARDE LOCALE ET IMPORTATION (.plagiat)
═══════════════════════════════════════════════ */
const _OB_KEY = "AntiTricheEdition2026!";

function obfuscatePlagiat(jsonStr) {
  let enc = encodeURIComponent(jsonStr);
  let checksum = 0;
  for(let i=0; i<enc.length; i++) {
    checksum = ((checksum << 5) - checksum) + enc.charCodeAt(i);
    checksum |= 0;
  }
  let finalStr = checksum + "|" + enc;
  let xored = "";
  for(let i=0; i<finalStr.length; i++) {
    xored += String.fromCharCode(finalStr.charCodeAt(i) ^ _OB_KEY.charCodeAt(i % _OB_KEY.length));
  }
  return btoa(xored);
}

function deobfuscatePlagiat(b64) {
  let xored = atob(b64);
  let finalStr = "";
  for(let i=0; i<xored.length; i++) {
    finalStr += String.fromCharCode(xored.charCodeAt(i) ^ _OB_KEY.charCodeAt(i % _OB_KEY.length));
  }
  let sep = finalStr.indexOf('|');
  if (sep === -1) throw new Error("Sceau cryptographique manquant (Falsification détectée)");
  let expectedChecksum = parseInt(finalStr.substring(0, sep), 10);
  let enc = finalStr.substring(sep + 1);
  let checksum = 0;
  for(let i=0; i<enc.length; i++) {
    checksum = ((checksum << 5) - checksum) + enc.charCodeAt(i);
    checksum |= 0;
  }
  if (checksum !== expectedChecksum) throw new Error("L'empreinte du fichier est invalide (Falsification détectée)");
  return decodeURIComponent(enc);
}

function exportPlagiatFile() {
  const obj = build();
  // Sécurisation Phase 16 : Chiffrement XOR + Empreinte d'intégrité (Checksum)
  const jsonStr = JSON.stringify(obj);
  const obfuscated = obfuscatePlagiat(jsonStr);
  
  const blob = new Blob([obfuscated], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  const safeName = S.name ? S.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'anonyme';
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `sauvegarde_${safeName}_${dateStr}.plagiat`;
  
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importPlagiatFile(event) {
  prepareInternalAction();
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const obfuscated = e.target.result;
      const jsonStr = deobfuscatePlagiat(obfuscated);
      const obj = JSON.parse(jsonStr);
      
      if (!obj || obj.text === undefined) throw new Error("Format invalide");
      
      document.getElementById('ed').innerHTML = obj.text;
      if (obj.log) S.log = obj.log;
      if (obj.paste !== undefined) S.paste = obj.paste;
      if (obj.copy !== undefined) S.copy = obj.copy;
      if (obj.tabs !== undefined) S.tabs = obj.tabs;
      if (obj.focus !== undefined) S.focus = obj.focus;
      if (obj.screenshots !== undefined) S.screenshots = obj.screenshots;
      if (obj.absentMs !== undefined) S.absentMs = obj.absentMs;
      if (obj.photos !== undefined) _photos = obj.photos; // Restaure aussi les photos
      if (obj.t0) S.t0 = obj.t0; // Chronomètre naturel
      
      log('IMPORTATION', 'Fichier de sauvegarde locale (.plagiat) restauré avec succès.', 'i');
      
      autoSave(); 
      updLog();
      
      showToast('Sauvegarde importée avec succès ✓');
      playAlert('save');
    } catch (err) {
      console.error(err);
      showToast('⚠️ Fichier invalide ou corrompu.');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════════════
   SAUVEGARDE FURTIVE (LOCAL RECOVERY) - PISTE 1
═══════════════════════════════════════════════ */
let _draftTimer = null;
function scheduleDraftSave() {
  if(S.submitted) return;
  if(_draftTimer) clearTimeout(_draftTimer);
  _draftTimer = setTimeout(function(){
    try {
      const obj = {v:1, S:S, text:ed.innerHTML};
      const data = obfuscatePlagiat(JSON.stringify(obj));
      localStorage.setItem('antiplagiat_draft', data);
      localStorage.setItem('antiplagiat_draft_time', Date.now());
      console.log("💾 Sauvegarde furtive effectuée (" + ed.innerHTML.length + " chars)");
    } catch(e) { console.warn("Quota localStorage atteint ou accès refusé."); }
  }, 2000);
}

function checkDraftOnLoad() {
  try {
    console.log("🔍 Vérification de session locale...");
    const draft = localStorage.getItem('antiplagiat_draft');
    if(draft) {
      // Vérification de l'intégrité du draft déobfusqué
      const decoded = deobfuscatePlagiat(draft);
      if(!decoded || decoded.charAt(0) !== '{') throw new Error("Data corruption");
      const obj = JSON.parse(decoded);
      if(!obj || !obj.S) throw new Error("Invalid format");

      // Ne montrer la zone de restauration QUE si l'écran de bienvenue est visible
      const welcome = document.getElementById('welcome');
      const isWelcomeVisible = welcome && (window.getComputedStyle(welcome).display !== 'none');
      
      if (isWelcomeVisible) {
        const zone = document.getElementById('draft-restore-zone');
        if(zone) zone.style.display = 'flex';
        console.log("💾 Draft trouvé et écran d'accueil actif : zone affichée.");
      }
    }
  } catch(e) {
    console.warn("Session corrompue détectée et nettoyée automatiquement :", e.message);
    clearDraftLocal();
  }
}

function clearAllLocalStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('antiplagiat_') || key.startsWith('scorm_editor_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    console.log("🧹 Nettoyage complet du localStorage effectué.");
  } catch(e) { console.warn("Erreur lors du nettoyage localStorage:", e); }
}

function clearDraftLocal() {
  clearAllLocalStorage();
  const zone = document.getElementById('draft-restore-zone');
  if(zone) zone.style.display = 'none';
  showToast('Sauvegarde furtive effacée.');
}

function confirmClearDraft() {
  if(confirm("Voulez-vous vraiment effacer cette sauvegarde locale ? Cette action est irréversible et vous devrez recommencer à neuf.")) {
    clearDraftLocal();
  }
}

function restoreDraftLocal() {
  try {
    const data = localStorage.getItem('antiplagiat_draft');
    const timeSaved = parseInt(localStorage.getItem('antiplagiat_draft_time') || Date.now());
    if(!data) return;
    const jsonStr = deobfuscatePlagiat(data);
    const obj = JSON.parse(jsonStr);
    
    document.getElementById('ed').innerHTML = obj.text;
    if (obj.S.log) S.log = obj.S.log;
    if (obj.S.paste !== undefined) S.paste = obj.S.paste;
    if (obj.S.copy !== undefined) S.copy = obj.S.copy;
    if (obj.S.tabs !== undefined) S.tabs = obj.S.tabs;
    if (obj.S.focus !== undefined) S.focus = obj.S.focus;
    if (obj.S.screenshots !== undefined) S.screenshots = obj.S.screenshots;
    if (obj.S.absentMs !== undefined) S.absentMs = obj.S.absentMs;

    // Réinitialisation de la soumission pour permettre la poursuite après restauration
    S.submitted = false;
    S.submitTime = null;
    localStorage.removeItem('scorm_editor_submitted');
    
    // Compensation du temps d'arrêt
    let timeLostMs = Date.now() - timeSaved;
    if(timeLostMs > 0) {
      if(!S.t0) S.t0 = Date.now(); 
      S.t0 += timeLostMs; 
    }
    
    document.getElementById('draft-restore-zone').style.display='none';
    log('REPRISE FURTIVE', 'Session inachevée restaurée suite à une interruption. (' + Math.floor(timeLostMs/60000) + ' min perdues)', 'i');
    
    // Si un nom était sauvegardé, on l'affiche (Correction: S.name au lieu de studentName)
    if(obj.S.name) {
      const nameInput = document.getElementById('student-name');
      if(nameInput) nameInput.value = obj.S.name;
    }
    
    updLog();
    updWC();
    
    showToast('Session restaurée ! Complétez les vérifications pour reprendre.');
    updLog();
    updWC();
    
    showToast('Session interrompue restaurée ✓');
    playAlert('save');
  } catch(e) {
    showToast('⚠️ Impossible de restaurer la session précédente.');
  }
}

function manualSave(quiet) {
  prepareInternalAction();
  autoSave();
  exportPlagiatFile();
  if(!quiet) {
    playAlert('save');
    showToast('Sauvegardé ✓ (Fichier .plagiat téléchargé)');
  }
}

function triggerImport() {
  prepareInternalAction();
  const input = document.getElementById('file-import');
  if (input) input.click();
}
function setSave(st){
  var el=document.getElementById('save-ind');
  if(st==='saved'){
    el.className='saved';
    var n=new Date();
    el.textContent='✓ Local+SCORM '+pad(n.getHours())+':'+pad(n.getMinutes());
  }else if(st==='saving'){
    el.className='saving';el.textContent='⟳ Sauvegarde…';
  }else{
    el.className='unsaved';el.textContent='● Non sauvegardé';
  }
}

/* ═══════════════════════════════════════════════
   ANTI-PLAGIAT
═══════════════════════════════════════════════ */
var _banT=null;
var _isInternalAction = false;

function prepareInternalAction() {
  _isInternalAction = true;
  // Sécurité au cas où le focus ne revient jamais (ex: dialogue système qui reste ouvert)
  setTimeout(() => { _isInternalAction = false; }, 10000);
}

function showBanner(){
  document.getElementById('alert-banner').classList.add('v');
  if(_banT)clearTimeout(_banT);
  /* Auto-dismiss après 3s — ne bloque pas l'interface */
  _banT=setTimeout(hideBanner, 3000);
}
function hideBanner(){
  document.getElementById('alert-banner').classList.remove('v');
  if(_banT){clearTimeout(_banT);_banT=null;}
}
function setupAP(){
  const config = SCORM.getConfig() || { security: {} };

  // 1. Blocage Menu Contextuel
  if (config.security.blockContextMenu) {
    document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      showToast('🚫 Menu contextuel désactivé.');
      log('SÉCURITÉ', 'Tentative d\'ouverture du menu contextuel bloquée.', 'w');
      return false;
    });
  }

  /* GESTION UNIFIÉE DES ABSENCES (Onglets/Fenêtres) */
  var _absentFocusLogged = false;
  var _absentTabLogged = false;

  function onAbsentStart(reason, isFocusLoss) {
    if(!_apReady || S.submitted || _isPaused || _isInternalAction) return;

    if(isFocusLoss && !_absentFocusLogged) {
      // Ne pas incrémenter ni loguer le focus si on consulte une ressource autorisée
      if (!_curRes) {
        S.focus++;
        log('PERTE DE FOCUS / APPLI', reason, 'd');
      }
      _absentFocusLogged = true;
    } else if(!isFocusLoss && !_absentTabLogged) {
      S.tabs++;
      log('NAV. ONGLET', reason, 'tabs');
      _absentTabLogged = true;
    }

    if(_absentStart) return;
    _absentStart = Date.now();
    
    if (!_curRes) {
      playAlert('leave');
    }
    
    showBanner();
    capturePhoto('Départ : ' + reason);
    updLog();
  }

  function onAbsentEnd(reason) {
    if(!_apReady || !_absentStart) {
      // Si on n'était pas vraiment "parti", on ne réinitialise pas forcément _isInternalAction
      // car un micro-focus peut arriver pendant l'ouverture d'un dialogue système.
      return;
    }
    _isInternalAction = false; // Réinitialisation seulement après un retour réel
    var now = Date.now();
    var ms = now - _absentStart;
    S.absentMs += ms;
    var dur = (ms / 1000).toFixed(1);
    
    _absentStart = null;
    _absentFocusLogged = false;
    _absentTabLogged = false;
    
    const type = reason.includes('Onglet') || reason.includes('visible') ? 'RETOUR (ONGLET)' : 'RETOUR (FOCUS)';
    log(type, 'Retour après ' + dur + 's (' + reason + ').', 'i');
    
    hideBanner();
    capturePhoto('Retour : ' + reason + ' (' + dur + 's)');
    updLog();
  }

  document.addEventListener('visibilitychange', function() {
    if(document.hidden) onAbsentStart('Réduction fenêtre ou onglet caché', false);
    else onAbsentEnd('Application redevenue visible');
  });

  /* Détection ultra-sensible du clic hors navigateur */
  window.addEventListener('blur', function(e) {
    if (e.target !== window) return; // Ignorer les blur d'éléments internes
    onAbsentStart('Clic hors navigateur ou changement d\'application', true);
  }, true);

  window.addEventListener('focusout', function() {
    if (document.hasFocus && document.hasFocus()) return; // Toujours dans la page (ex: clic barre d'outils)
    onAbsentStart('Perte de focus (focusout)', true);
  });

  window.addEventListener('focus', function() {
    onAbsentEnd('Retour application (focus)');
  }, true);

  /* Bogue SCORM/Moodle : Boucle active de vérification du focus (Polling) */
  setInterval(function() {
    if(!_apReady || S.submitted || _isPaused || _isInternalAction) return;

    if (document.hidden) {
      onAbsentStart('Onglet caché ou fenêtre réduite (Détection active)', false);
    } else if (!document.hasFocus()) {
      onAbsentStart('Perte de focus ou d\'application (Détection active)', true);
    } else {
      onAbsentEnd('Retour application (Détection active)');
    }
  }, 1000);

  // 2. Blocage des Raccourcis Système
  const blockedShortcuts = config.security.blockShortcuts || [];
  document.addEventListener('keydown',function(e){
    if(!_apReady||S.submitted)return;

    // Normalisation du raccourci
    let parts = [];
    if (e.ctrlKey) parts.push('Control');
    if (e.metaKey) parts.push('Meta');
    if (e.shiftKey) parts.push('Shift');
    if (e.altKey) parts.push('Alt');
    parts.push(e.key);
    let pressed = parts.join('+');

    if (blockedShortcuts.includes(e.key) || blockedShortcuts.includes(pressed)) {
      e.preventDefault();
      showToast('🚫 Raccourci ' + e.key + ' désactivé.');
      log('SÉCURITÉ', 'Raccourci bloqué : ' + pressed, 'd');
      return false;
    }

    if(e.key==='PrintScreen'||(e.ctrlKey&&e.shiftKey&&e.key==='S')){
      S.screenshots++;
      log('CAPTURE D\'ÉCRAN','PrintScreen détecté — photo de surveillance prise.','d');
      capturePhoto('Capture écran détectée');
      updLog();
    }
  });
}


/* COLLAGE : BLOQUÉ COMPLÈTEMENT */
function blockPaste(e){
  e.preventDefault();
  e.stopPropagation();
  S.paste++;
  playAlert('blocked');
  showToast('🚫 Coller est désactivé pendant l\'évaluation.');
  log('COLLAGE BLOQUÉ','Tentative de collage (Ctrl+V) interceptée et bloquée.','d');
  updLog();updSub();
  return false;
}

/* COPIE : BLOQUÉE COMPLÈTEMENT */
function blockCopy(e){
  e.preventDefault();
  e.stopPropagation();
  S.copy++;
  playAlert('blocked');
  showToast('🚫 Copier est désactivé pendant l\'évaluation.');
  log('COPIE BLOQUÉE','Tentative de copie (Ctrl+C) interceptée et bloquée.','d');
  updLog();updSub();
  return false;
}

/* DRAG AND DROP : BLOQUÉ COMPLÈTEMENT */
function blockDrop(e){
  e.preventDefault();
  e.stopPropagation();
  S.paste++;
  playAlert('blocked');
  showToast('🚫 Glisser-déposer est désactivé pendant l\'évaluation.');
  log('COLLAGE BLOQUÉ', 'Tentative de glisser-déposer interceptée et bloquée.', 'd');
  updLog(); updSub();
  return false;
}
document.addEventListener('drop', blockDrop, false);
document.addEventListener('dragover', function(e) { e.preventDefault(); }, false);

function log(type,detail,sev){
  var n=new Date();
  S.log.push({t:pad(n.getHours())+':'+pad(n.getMinutes())+':'+pad(n.getSeconds()),
    type:type,detail:detail,sev:sev||'i'});
  setSave('unsaved');updSub();updLog();
}
function updLog(){
  try {
    var bad = S.paste + S.copy + S.tabs + S.focus + S.screenshots;
    var bj = document.getElementById('bdg-j');
    if(bj){ bj.textContent = bad; bj.className = 'badge' + (bad > 0 ? '' : ' z'); }
    
    function _u(id, val, isZero) { 
      var el = document.getElementById(id); 
      if(!el) return;
      el.textContent = val;
      if(el.parentElement) el.parentElement.classList.toggle('z', !!isZero); 
    }
    
    _u('sc-paste', S.paste, S.paste === 0);
    _u('sc-copy',  S.copy,  S.copy === 0);
    _u('sc-tab',   S.tabs,  S.tabs === 0);
    _u('sc-focus', S.focus, S.focus === 0);
    _u('sc-photo', S.photos, S.photos === 0);
    _u('sc-abs',   Math.round(S.absentMs/1000) + 's', S.absentMs === 0);

    var ll = document.getElementById('loglist');
    if(!ll) return; 
    if(!S.log.length){ll.innerHTML='<div style="text-align:center;color:#aaa;padding:18px;font-size:11px">Aucun événement</div>';return;}
    var h='';
    S.log.slice(-50).reverse().forEach(function(e){
      h+='<div class="le '+e.sev+'"><div><span class="ltime">'+esc(e.t)+'</span>'
        +'<span class="lt">'+esc(e.type)+'</span></div>';
      if(e.detail)h+='<div class="ldtl">'+esc(e.detail)+'</div>';
      h+='</div>';
    });
    ll.innerHTML=h;
  } catch(e) { console.error("Erreur log UI:", e); }
}

/* ═══════════════════════════════════════════════
   COMPTEUR MOTS
═══════════════════════════════════════════════ */
function onCh(){updWC();setSave('unsaved');updTb();scheduleDraftSave();}
function updWC(){
  var t=ed.textContent||'';
  S.wc=t.trim().split(/\s+/).filter(function(w){return w.length>0;}).length;
  S.cc=t.replace(/\s/g,'').length;
  document.getElementById('sb-wc').textContent='Mots\u00a0: '+S.wc+' | Caract.\u00a0: '+S.cc;
  document.getElementById('si-mots').textContent=S.wc;
  updWordBar(S.wc);
}

/* ═══════════════════════════════════════════════
   BARRE D'OUTILS
═══════════════════════════════════════════════ */
/* ── SYNTHÈSE VOCALE NATIVE (Phase 21) ── */
let isSpeaking = false;
function toggleTTS() {
  const btn = document.getElementById('btn-tts');
  if (isSpeaking) { stopTTS(); return; }
  const selection = window.getSelection().toString();
  const textToRead = selection || ed.innerText;
  if (!textToRead.trim()) return;
  const msg = new SpeechSynthesisUtterance(textToRead);
  msg.lang = 'fr-FR';
  const voices = window.speechSynthesis.getVoices();
  const frVoice = voices.find(v => v.lang.startsWith('fr'));
  if (frVoice) msg.voice = frVoice;
  msg.onstart = () => { isSpeaking = true; btn.classList.add('active-tts'); };
  msg.onend = () => { isSpeaking = false; btn.classList.remove('active-tts'); };
  msg.onerror = () => { isSpeaking = false; btn.classList.remove('active-tts'); };
  window.speechSynthesis.speak(msg);
}
function stopTTS() { window.speechSynthesis.cancel(); isSpeaking = false; const btn = document.getElementById('btn-tts'); if (btn) btn.classList.remove('active-tts'); }
ed.addEventListener('keydown', () => { if (isSpeaking) stopTTS(); });

function fmt(cmd,val){document.execCommand(cmd,false,val||null);ed.focus();updTb();}
function applyFont(){document.execCommand('fontName',false,document.getElementById('sel-font').value);ed.focus();}
function applySize(){
  var sz=document.getElementById('sel-size').value;
  document.execCommand('fontSize',false,4);
  ed.querySelectorAll('font[size="4"]').forEach(function(s){s.style.fontSize=sz;s.removeAttribute('size');});
  ed.focus();
}
function applyColor(){document.execCommand('foreColor',false,document.getElementById('clr-txt').value);ed.focus();}
function ins(ch){document.execCommand('insertText',false,ch);ed.focus();}
function updTb(){
  var m={'b-bold':'bold','b-ital':'italic','b-ulin':'underline','b-strk':'strikeThrough',
         'b-al':'justifyLeft','b-ac':'justifyCenter','b-ar':'justifyRight','b-aj':'justifyFull'};
  Object.keys(m).forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.classList.toggle('on',document.queryCommandState(m[id]));
  });
}

/* ═══════════════════════════════════════════════
   RESSOURCES — chronométrage complet des sorties
   Journal : ouverture, fermeture, durée, nb visites
═══════════════════════════════════════════════ */
var RURL = {}; // Initialisé dynamiquement par initDynamicResources

/* Statistiques par ressource */
var _resStat = {}; 

var _curRes=null, _popupWin=null;

/**
 * Ouvre la ressource et affiche l'overlay de verrouillage
 */
function openRes(key){
  const config = SCORM.getConfig();
  const res = config.pedagogy.allowedResources.find(r => r.id === key);
  if (!res) return;

  _curRes = key;
  if (!_resStat[key]) _resStat[key] = {visits:0, totalMs:0, lastOpen:null};
  
  _resStat[key].visits++;
  _resStat[key].lastOpen = Date.now();

  showResModal(res);
  updLog(); updResSummary();
  log('CONSULTATION RESSOURCE', res.title + ' — Interface verrouillée pour suivi des ressources.','i');
}

/**
 * Affiche l'overlay de verrouillage (Interlock)
 */
function showResModal(res) {
  const modal = document.getElementById('res-modal');
  const title = document.getElementById('rm-title');
  const desc = document.getElementById('rm-desc');
  const openBtn = document.getElementById('rm-btn-open');
  const iconCont = document.getElementById('rm-icon');
  const finishBtn = document.querySelector('.rm-btn-finish');
  
  title.textContent = res.title;
  desc.innerHTML = `Vous consultez actuellement <strong>${res.title}</strong>. L'éditeur est <strong>verrouillé</strong> pour garantir l'équité. Cliquez sur le bouton ci-dessous pour ouvrir la ressource.`;
  
  // État initial des boutons
  openBtn.style.display = 'flex';
  finishBtn.style.display = 'flex';
  finishBtn.querySelector('span').textContent = "Annuler / Retour à l'éditeur";
  
  // Icône dynamique
  let iconSvg = '';
  if (res.icon === 'book') {
    iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>';
  } else if (res.icon === 'edit-3') {
    iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  } else {
    iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  }
  iconCont.innerHTML = iconSvg;

  openBtn.onclick = function() {
    _popupWin = window.open(res.url, 'ressource_auth', 'width=1000,height=750,toolbar=0,menubar=0,location=0,status=0,scrollbars=1,resizable=1');
    if(!_popupWin){
      showToast('⚠️ Autorisez les popups dans votre navigateur.');
      return;
    }
    
    // Forcer l'étudiant à fermer le popup pour déverrouiller
    openBtn.style.display = 'none';
    finishBtn.style.display = 'none';
    desc.innerHTML = `La ressource <strong>${res.title}</strong> est ouverte dans une fenêtre séparée.<br><br><span style="color:#6ee7b7">Vous devez <strong>fermer cette fenêtre popup</strong> pour déverrouiller l'éditeur.</span>`;
    
    // Surveiller la fermeture de la fenêtre
    let _popupPoll = setInterval(function(){
      if(!_popupWin || _popupWin.closed){
        clearInterval(_popupPoll);
        _popupWin = null;
        finishRes(); // Fermeture automatique et log
      }
    }, 1000);
  };
  
  modal.classList.add('v');
}

/**
 * Ferme le verrouillage et enregistre la durée
 */
function finishRes() {
  const key = _curRes;
  if(key && _resStat[key] && _resStat[key].lastOpen){
    const dur = Math.round((Date.now() - _resStat[key].lastOpen)/1000);
    _resStat[key].totalMs += Date.now() - _resStat[key].lastOpen;
    _resStat[key].lastOpen = null;
    log('RESSOURCE FERMÉE', (RURL[key]?RURL[key].label:key) + ' — durée : ' + fmtDur(dur), 'i');
    updLog(); updResSummary();
  }
  document.getElementById('res-modal').classList.remove('v');
  _curRes = null;
}


/* Formater une durée en secondes → "1m 34s" ou "45s" */
function fmtDur(s){
  if(s<60) return s+'s';
  return Math.floor(s/60)+'m '+pad(s%60)+'s';
}

/* Mise à jour du résumé dans le panneau Ressources */
function updResSummary(){
  var el=document.getElementById('res-modern-summary');
  if(!el)return;
  var html='';
  Object.keys(_resStat).forEach(function(k){
    var st=_resStat[k];
    if (st.visits === 0 && !st.lastOpen) return;
    
    var live = st.lastOpen ? Math.round((Date.now() - st.lastOpen) / 1000) : 0;
    var total = Math.round(st.totalMs / 1000) + live;
    var isOpen = !!st.lastOpen;
    
    html += `
      <div class="res-stat-item">
        <div class="rsi-info">
          <div class="rsi-name">${RURL[k] ? RURL[k].label : k}</div>
          <div class="rsi-val"><b>${st.visits}</b> visite${st.visits !== 1 ? 's' : ''} — <b>${fmtDur(total)}</b></div>
        </div>
        ${isOpen ? '<div class="rsi-live-badge">En cours</div>' : ''}
      </div>
    `;
  });
  if (!html) html = '<div style="text-align:center; opacity:0.5; padding: 10px;">Aucune ressource consultée pour le moment.</div>';
  el.innerHTML=html;
}


/* Ticker live pour mettre à jour le chrono en cours */
setInterval(function(){
  if(_curRes&&_resStat[_curRes].lastOpen) updResSummary();
},5000);

/* ═══════════════════════════════════════════════
   IMPRESSION
═══════════════════════════════════════════════ */
function printDoc(){
  prepareInternalAction();
  fillPrintFrame();
  var was = hideOverlays();
  setTimeout(function(){
    window.print();
    setTimeout(function(){ restoreOverlays(was); }, 500);
  }, 120);
}

/* ═══════════════════════════════════════════════
   SOUMETTRE
═══════════════════════════════════════════════ */
function updSub(){
  document.getElementById('si-paste').textContent =S.paste;
  document.getElementById('si-copy').textContent  =S.copy;
  document.getElementById('si-tab').textContent   =S.tabs;
  document.getElementById('si-foc').textContent   =S.focus;
  document.getElementById('si-ss').textContent    =S.screenshots;
  document.getElementById('si-photos').textContent=_photos.length;
  document.getElementById('si-nom').textContent   =S.name;
}
function confirmSub(){
  if(S.submitted)return;
  /* Pas de minimum de mots — l'enseignant décide */
  showModal('Confirmer la soumission',
    'Une fois soumis, votre texte sera <strong>verrouillé</strong> et transmis à votre enseignant(e). Action irréversible.',
    [{lbl:'Annuler',cls:'s',fn:'closeModal()'},
     {lbl:'Soumettre',cls:'p',fn:'doSubmit()'}]);
}
function doSubmit(){
  closeModal();
  S.submitted=true;S.submitTime=new Date().toLocaleString('fr-CA');
  capturePhoto('Photo de soumission finale');
  SCORM.save(build());SCORM.submit(100);
  playAlert('submit');
  lockEd();
  showSubmittedOverlay();
  document.getElementById('sub-ok').style.display='block';
  var bs=document.getElementById('btn-sub');bs.disabled=true;bs.textContent='✅ Travail soumis';
  log('SOUMISSION','Travail soumis dans le carnet de notes Moodle.','i');
  clearDraftLocal();
  updLog();swP('sub');
}
function lockEd(lock){
  if(lock === undefined) lock = true;
  ed.contentEditable = lock ? 'false' : 'true';
  if(lock) ed.classList.add('locked'); else ed.classList.remove('locked');
  document.querySelectorAll('#tb .tb-btn, #tb .tb-sel, #tb .tb-color').forEach(function(el){
    el.disabled = lock;
    el.style.opacity = lock ? '.35' : '1';
    el.style.pointerEvents = lock ? 'none' : 'auto';
  });
  if(S.submitted){
    var btnSub = document.getElementById('btn-sub');
    if(btnSub) {
      btnSub.disabled = true;
      btnSub.textContent = '✅ Soumis';
    }
    var subOk = document.getElementById('sub-ok');
    if(subOk) subOk.style.display = 'block';
  }
}

/* ═══════════════════════════════════════════════
   MODAL GÉNÉRIQUE
═══════════════════════════════════════════════ */
function showModal(title,msg,btns){
  document.getElementById('m-title').textContent=title;
  document.getElementById('m-msg').innerHTML=msg;
  document.getElementById('m-btns').innerHTML=btns.map(function(b){
    return '<button class="mbtn '+b.cls+'" onclick="'+b.fn+'">'+b.lbl+'</button>';
  }).join('');
  document.getElementById('modal').classList.add('v');
}
function closeModal(){document.getElementById('modal').classList.remove('v');}

/* ═══════════════════════════════════════════════
   UTILITAIRES
═══════════════════════════════════════════════ */
function swP(n){
  document.querySelectorAll('.ptab').forEach(function(t){t.classList.toggle('on',t.dataset.p===n);});
  document.querySelectorAll('.pc').forEach(function(c){c.classList.toggle('on',c.id==='pc-'+n);});
  if(n==='sub')updSub();
}
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
var _tt2=null;
function showToast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('v');
  if(_tt2)clearTimeout(_tt2);
  _tt2=setTimeout(function(){t.classList.remove('v');},2800);
}

/* ═══════════════════════════════════════════════
   OBJECTIF DE MOTS (configurable par l'enseignant)
   Modifier _wordGoal pour changer la cible.
═══════════════════════════════════════════════ */
var _wordGoal = 0; /* 0 = pas d'objectif. Ex: 300 pour 300 mots requis */

/* ═══════════════════════════════════════════════
   ÉCRAN D'ACCUEIL
═══════════════════════════════════════════════ */
let _camTestedOk = false;
let _screenTestedOk = false;

function checkStartReady() {
  const nameInput = document.getElementById('student-name');
  const chkAgree = document.getElementById('chk-agree');
  const btnStart = document.getElementById('btn-start');
  
  if (nameInput && chkAgree && btnStart) {
    let ready = nameInput.value.trim().length >= 2 && chkAgree.checked;
    
    // Step 2 : Caméra obligatoire
    ready = ready && _camTestedOk;
    
    // Step 3 : Capture d'écrans (si activé)
    const step3 = document.getElementById('cl-step3');
    if (step3 && step3.style.display !== 'none') {
      ready = ready && _screenTestedOk;
    }
    
    if (ready) {
      btnStart.disabled = false;
      btnStart.innerHTML = '🚀 Démarrer l\'évaluation';
    } else {
      btnStart.disabled = true;
      btnStart.innerHTML = '🔒 Vérifications requises...';
    }
  }
}

async function testCameraPreflight() {
  const btn = document.getElementById('btn-cam');
  btn.textContent = 'Connexion...';
  btn.disabled = true;
  try {
    _camStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
    let vid = document.getElementById('cam-video');
    if (vid) vid.srcObject = _camStream;
    
    let prevVid = document.getElementById('cam-preview-vid');
    if (prevVid) prevVid.srcObject = _camStream;
    
    document.getElementById('cam-preview-bubble').style.display = 'block';
    document.getElementById('st-2-icon').style.display = 'inline';
    btn.style.display = 'none';
    _camTestedOk = true;
    checkStartReady();
  } catch (err) {
    alert("Impossible d'accéder à la caméra. Vérifiez les permissions de votre navigateur.");
    btn.textContent = '📸 Réessayer la caméra';
    btn.disabled = false;
  }
}

function toggleScreenBtn() {
  const btn = document.getElementById('btn-screen');
  btn.disabled = false;
  const radios = document.getElementsByName('has2');
  for (let i=0; i<radios.length; i++) {
    if (radios[i].checked) {
      _screenCount = (radios[i].value === 'yes') ? 2 : 1;
    }
  }
  btn.textContent = _screenCount === 2 ? '🖥️ Partager mes 2 écrans' : '🖥️ Partager mon écran';
}

async function testScreenPreflight() {
  const btn = document.getElementById('btn-screen');
  btn.textContent = 'Connexion...';
  btn.disabled = true;
  _screenStreams = [];
  try {
    for(let i=0; i<_screenCount; i++){
       showToast('Partagez l\'écran ' + (i+1) + '/' + _screenCount + '...');
       let stream = await navigator.mediaDevices.getDisplayMedia({
         video: { displaySurface: 'monitor' },
         audio: false
       });
       _screenStreams.push(stream);
    }
    if (_screenStreams.length === _screenCount) {
      _screenEnabled = true;
      _screenTestedOk = true;
      btn.style.display = 'none';
      document.getElementById('st-3-icon').style.display = 'inline';
      checkStartReady();
    } else {
      throw new Error("Missing stream");
    }
  } catch (err) {
    alert("Vous devez accepter le partage d'écran complet pour continuer.");
    btn.textContent = _screenCount === 2 ? '🖥️ Réessayer (2 écrans)' : '🖥️ Réessayer (1 écran)';
    btn.disabled = false;
  }
}

function renderConsigne() {
  var d = document.getElementById('consigne-display');
  var f = document.getElementById('pf-consigne-text');
  var w = document.getElementById('pf-consigne-wrap');
  if(!S.consigne || S.consigne.trim().length === 0) {
    if(d) d.innerHTML = '<div style="color:var(--text-3); font-style:italic; text-align:center; margin-top:40px;">Aucune consigne n\'a été saisie au démarrage de l\'examen.</div>';
    if(w) w.style.display = 'none';
    return;
  }
  var safe = esc(S.consigne);
  if(d) d.innerHTML = safe;
  if(f) f.innerHTML = safe;
  if(w) w.style.display = 'block';
}

async function startExamReal(){
  // Réinitialisation de l'état de soumission pour le nouvel essai
  S.submitted = false;
  S.submitTime = null;
  // Nettoyage des indicateurs de soumission dans le localStorage
  localStorage.removeItem('scorm_editor_submitted');

  // Purge préventive si un ancien draft n'a pas été restauré (ignorer le brouillon)
  const zone = document.getElementById('draft-restore-zone');
  if (zone && zone.style.display !== 'none') {
    console.log("🚀 Nouveau départ : purge des anciennes sessions.");
    clearAllLocalStorage();
  }

  const nameVal = document.getElementById('student-name').value.trim();
  if (nameVal) {
    S.name = nameVal;
    var hdrN = document.getElementById('hdr-user-name');
    if (hdrN) hdrN.textContent = '👤 ' + S.name;
    updSub();
  }

  // Capture de la consigne
  var cInp = document.getElementById('work-instructions');
  if (cInp) {
    S.consigne = cInp.value;
    renderConsigne();
  }

  document.getElementById('welcome').style.display = 'none';
  _apReady = true;

  if (!S.t0) S.t0 = Date.now();
  
  startClock();
  log('DÉBUT EXAMEN','L\'étudiant ('+S.name+') a commencé l\'évaluation.','i');
  
  if (_camStream) {
    setCamStatus(true,'');
    scheduleRandCapture();
  }
  
  /* Photo d'identification (La caméra tourne déjà grâce au pre-flight !) */
  setTimeout(function(){ capturePhoto('Début examen — identification'); }, 800);
}

/* Met à jour le badge nom sur l'écran d'accueil */
function updWelcomeName(name){
  var el = document.getElementById('wc-name');
  if(el) el.textContent = '👤 ' + name;
}

/* ═══════════════════════════════════════════════
   OVERLAY SOUMIS — affiché après soumission
═══════════════════════════════════════════════ */
function showSubmittedOverlay(){
  var ov = document.getElementById('submitted-overlay');
  var st = document.getElementById('so-time');
  if(st) st.textContent = 'Soumis le : ' + S.submitTime;
  if(ov) ov.classList.add('v');
}

/* ═══════════════════════════════════════════════
   MODE FOCUS — masque le panneau droit
═══════════════════════════════════════════════ */
function toggleFocus(){
  document.body.classList.toggle('focus-mode');
  var btn = document.getElementById('btn-focus-mode');
  var txt = document.getElementById('btn-focus-mode-txt');
  if(document.body.classList.contains('focus-mode')){
    if(txt) txt.textContent = 'Panneau';
    btn.title = 'Afficher le panneau';
  } else {
    if(txt) txt.textContent = 'Focus';
    btn.title = 'Mode focus — masquer le panneau';
  }
}

/* ═══════════════════════════════════════════════
   BARRE DE PROGRESSION MOTS
═══════════════════════════════════════════════ */
function updWordBar(wc){
  var bar = document.getElementById('wc-bar');
  if(!bar || _wordGoal <= 0) return;
  var pct = Math.min(100, Math.round(wc / _wordGoal * 100));
  bar.style.width = pct + '%';
  bar.className = pct >= 100 ? 'done' : (pct >= 90 ? 'over' : '');
  /* Mettre à jour le texte objectif dans Soumettre */
  var gi = document.getElementById('si-goal');
  if(gi) gi.textContent = wc + ' / ' + _wordGoal + ' mots (' + pct + '%)';
}


/* ═══════════════════════════════════════════════
   REMPLISSAGE DU CADRE D'IMPRESSION
   Fonction partagée par printDoc() et exportPDF()
═══════════════════════════════════════════════ */
function fillPrintFrame(){
  var n = new Date();
  var endStr = S.submitTime || n.toLocaleString('fr-CA');

  document.getElementById('pf-nom-big').textContent  = S.name;
  document.getElementById('pf-id').textContent       = S.id || '—';
  document.getElementById('pf-ft-nom').textContent   = S.name;
  document.getElementById('pf-start').textContent    = S.startWall;
  document.getElementById('pf-end').textContent      = endStr;
  document.getElementById('pf-ft-start').textContent = S.startWall;
  document.getElementById('pf-ft-end').textContent   = endStr;
  document.getElementById('pf-dur').textContent      = _cs;
  document.getElementById('pf-absent').textContent   = absentStr();
  document.getElementById('pf-stat').textContent     = S.submitted ? '✅ Soumis' : '⏳ Non soumis';
  document.getElementById('pf-mots').textContent     = S.wc;
  document.getElementById('pf-chars').textContent    = S.cc;
  document.getElementById('pf-pdate').textContent    = n.toLocaleString('fr-CA');
  document.getElementById('pf-paste').textContent    = S.paste;
  document.getElementById('pf-copy').textContent     = S.copy;
  document.getElementById('pf-tab').textContent      = S.tabs;
  document.getElementById('pf-focus').textContent    = S.focus;
  document.getElementById('pf-ss').textContent       = S.screenshots;
  document.getElementById('pf-photo').textContent    = S.photos;
  document.getElementById('pf-conj-v').textContent   = _resStat.conjugueur.visits;
  document.getElementById('pf-conj-t').textContent   = fmtDur(Math.round(_resStat.conjugueur.totalMs/1000)
    + (_resStat.conjugueur.lastOpen ? Math.round((Date.now()-_resStat.conjugueur.lastOpen)/1000) : 0));
  document.getElementById('pf-usito-v').textContent  = _resStat.usito.visits;
  document.getElementById('pf-usito-t').textContent  = fmtDur(Math.round(_resStat.usito.totalMs/1000)
    + (_resStat.usito.lastOpen ? Math.round((Date.now()-_resStat.usito.lastOpen)/1000) : 0));
  document.getElementById('pf-text').innerHTML = ed.innerHTML;

  var pw = document.getElementById('pf-photos-wrap');
  var pl = document.getElementById('pf-photos-list');
  if(_photos.length){
    pw.style.display = 'block';
    pl.innerHTML = _photos.map(function(p){
      let h = '<div class="pf-photo"><img src="'+p.dataUrl+'" alt="surveillance">';
      if(p.screens && p.screens.length > 0) {
        p.screens.forEach(function(s, idx){
          h += '<img src="'+s+'" alt="ecran" title="Écran '+(idx+1)+'">';
        });
      }
      h += '<span>'+esc(p.time)+'<br>'+esc(p.reason)+'</span></div>';
      return h;
    }).join('');
  } else { pw.style.display = 'none'; }

  var jl = document.getElementById('pf-journal-list');
  if(S.log && S.log.length){
    jl.innerHTML = S.log.map(function(e){
      return '<div class="pf-le '+e.sev+'">'
        +'<span class="pf-le-t">'+esc(e.t)+'</span>'
        +'<span class="pf-le-type">'+esc(e.type)+'</span>'
        +(e.detail ? '<span class="pf-le-detail">'+esc(e.detail)+'</span>' : '')
        +'</div>';
    }).join('');
  } else {
    jl.innerHTML = '<p style="color:#aaa;font-size:9pt;font-style:italic">Aucun événement.</p>';
  }
}

/* ═══════════════════════════════════════════════
   MASQUER / RESTAURER LES OVERLAYS
   Utilisé avant impression et avant génération PDF
═══════════════════════════════════════════════ */
function hideOverlays(){
  var ids = ['submitted-overlay','alert-banner','recovery-banner','welcome'];
  var was = {};
  ids.forEach(function(id){
    var el = document.getElementById(id);
    if(!el){ was[id]=false; return; }
    if(id === 'submitted-overlay' || id === 'alert-banner'){
      was[id] = el.classList.contains('v'); el.classList.remove('v');
    } else {
      was[id] = el.style.display !== 'none'; el.style.display = 'none';
    }
  });
  return was;
}
function restoreOverlays(was){
  var el;
  el = document.getElementById('submitted-overlay');
  if(el && was['submitted-overlay']) el.classList.add('v');
  el = document.getElementById('alert-banner');
  if(el && was['alert-banner']) el.classList.add('v');
  el = document.getElementById('recovery-banner');
  if(el && was['recovery-banner']) el.style.display = 'block';
  el = document.getElementById('welcome');
  if(el && was['welcome']) el.style.display = 'flex';
}

/* ═══════════════════════════════════════════════
   EXPORT PDF — html2pdf.js (chargé à la demande)
═══════════════════════════════════════════════ */
var _html2pdfLoaded = false;

function loadHtml2pdf(cb){
  if(_html2pdfLoaded){ cb(); return; }
  var sc = document.createElement('script');
  sc.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
  sc.onload = function(){ _html2pdfLoaded = true; cb(); };
  sc.onerror = function(){
    showToast('⚠ Impossible de charger la bibliothèque PDF. Vérifiez votre connexion Internet.');
  };
  document.head.appendChild(sc);
}

function showPdfProgress(msg, sub, pct){
  var el = document.getElementById('pdf-progress');
  var txt = document.getElementById('pdf-progress-txt');
  var sbt = document.getElementById('pdf-status-sub');
  var bar = document.getElementById('pdf-bar-fill');
  if(msg && txt) txt.textContent = msg;
  if(sub && sbt) sbt.textContent = sub;
  if(pct !== undefined && bar) bar.style.width = pct + '%';
  if(el) el.classList.add('v');
}
function hidePdfProgress(){
  var el = document.getElementById('pdf-progress');
  if(el) el.classList.remove('v');
}

function exportPDF(){
  prepareInternalAction();
  showPdfProgress('Préparation...', 'Extraction du contenu', 15);
  fillPrintFrame();

  var nom = S.name.replace(/[^a-zA-Z0-9_\- ]/g,'').trim() || 'etudiant';
  var date = new Date().toISOString().slice(0,10);
  var filename = 'travail_' + nom + '_' + date + '.pdf';

  loadHtml2pdf(function(){
    showPdfProgress('Traitement...', 'Conversion vers le format PDF', 45);
    var was = hideOverlays();

    /* Clone du cadre d'impression pour html2pdf
       On ne peut pas lui passer directement #pf car il est
       display:none et html2pdf ne supporte pas les éléments cachés */
    var pf = document.getElementById('pf');
    var clone = pf.cloneNode(true);
    /* Même approche que v15 — width:210mm avec padding interne,
       html2pdf scale automatiquement pour tenir dans les marges.
       C'est la seule approche validée sans troncature. */
    clone.style.cssText = 'display:block;font-family:Times New Roman,serif;font-size:11pt;'
      + 'line-height:1.65;color:#000;background:#fff;padding:20mm 18mm 20mm 22mm;'
      + 'width:210mm;box-sizing:border-box';

    var styleEl = document.createElement('style');
    styleEl.textContent = [
      'ul,ol{padding-left:2em;margin:4px 0}',
      'ul{list-style-type:disc}',
      'ul ul{list-style-type:circle}',
      'ul ul ul{list-style-type:square}',
      'ol{list-style-type:decimal}',
      'ol ol{list-style-type:lower-alpha}',
      'li{display:list-item;margin:2px 0}',
      'ul>div,ol>div{display:list-item;margin:2px 0}',
      'table{width:100%;border-collapse:collapse;font-size:8pt}',
      'td{padding:2px 7px;border:1px solid #ddd;font-family:Arial,sans-serif}',
      '.pl{background:#eef0f7;font-weight:700;width:22%}',
      '.pf-nom-big{font-size:22pt;font-weight:700;color:#1a237e;'
        +'border-bottom:3px solid #2b579a;padding-bottom:4px;margin:3px 0 2px;'
        +'font-family:Arial,sans-serif}',
      '.pf-id-line{font-size:9pt;color:#555;margin-bottom:10px;font-family:Arial,sans-serif}',
      '.pf-logo{font-size:8pt;color:#888;font-family:Arial,sans-serif}',
      '.pf-times-box{display:flex;width:100%;border:1px solid #b0b8d0;margin-bottom:10px;font-family:Arial,sans-serif}',
      '.pf-time-row{flex:1;padding:5px 10px;border-right:1px solid #b0b8d0;background:#f0f4ff}',
      '.pf-time-row:last-child{border-right:none}',
      '.pf-absent-row{background:#fff0f0}',
      '.pf-time-lbl{font-size:7.5pt;color:#666;display:block;margin-bottom:1px}',
      '.pf-time-val{font-size:12pt;font-weight:700;color:#1a237e;display:block}',
      '.pf-absent-row .pf-time-val{color:#c62828}',
      'hr{border:none;border-top:1px solid #ccc;margin:14px 0}',
      '.pf-sec-title{font-size:9pt;color:#2b579a;font-weight:700;text-transform:uppercase;'
        +'letter-spacing:.5px;border-bottom:2px solid #2b579a;padding-bottom:2px;'
        +'margin:0 0 8px;font-family:Arial,sans-serif}',
      '.pf-le{display:flex;gap:8px;padding:2px 6px;margin:2px 0;border-left:3px solid #ccc;font-size:8pt}',
      '.pf-le.d{background:#fff3f3;border-color:#c62828}',
      '.pf-le.w{background:#fff8e1;border-color:#e65100}',
      '.pf-le.i{background:#f1f8e9;border-color:#388e3c}',
      '.pf-le-t{font-weight:700;white-space:nowrap;min-width:58px;color:#666}',
      '.pf-le-type{font-weight:700;min-width:130px}',
      '.pf-le.d .pf-le-type{color:#c62828}',
      '.pf-le.w .pf-le-type{color:#e65100}',
      '.pf-le.i .pf-le-type{color:#388e3c}',
      '.pf-le-detail{color:#444;font-style:italic}',
      '.pv.r{color:#c62828;font-weight:700}',
      '.pv.o{color:#e65100;font-weight:700}',
      '.pf-ft{border-top:2px solid #2b579a;margin-top:14px;padding-top:5px;'
        +'font-size:7.5pt;color:#666;font-family:Arial,sans-serif}',
      '.pf-photos-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}',
      '.pf-photo{display:flex;flex-direction:column;align-items:center;gap:2px}',
      '.pf-photo img{width:88px;height:66px;object-fit:cover;border:1px solid #ccc}',
      '.pf-photo span{font-size:7pt;color:#666;text-align:center;max-width:88px;line-height:1.2}',
    ].join('\n');
    clone.insertBefore(styleEl, clone.firstChild);

    var opt = {
      margin:       [15, 15, 15, 20],
      filename:     filename,
      image:        { type:'jpeg', quality:0.92 },
      html2canvas:  { scale:2, useCORS:true, logging:false,
                      backgroundColor:'#ffffff' },
      jsPDF:        { unit:'mm', format:'a4', orientation:'portrait' },
      pagebreak:    { mode:['avoid-all','css','legacy'] }
    };

    /* Numéros de page via jsPDF — ajoutés après génération */
    html2pdf().set(opt).from(clone).toPdf().get('pdf').then(function(pdf){
      showPdfProgress('Finalisation...', 'Marquage des pages', 85);
      var total = pdf.internal.getNumberOfPages();
      var w     = pdf.internal.pageSize.getWidth();
      var h2    = pdf.internal.pageSize.getHeight();
      for(var i=1; i<=total; i++){
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(150,150,150);
        /* Pied de page centré */
        pdf.text('Page ' + i + ' / ' + total, w/2, h2 - 8, {align:'center'});
        /* Pied de page gauche */
        pdf.text('Éditeur anti-plagiat v2.0.0', 20, h2 - 8);
        /* Pied de page droit — nom étudiant */
        pdf.text(S.name, w - 20, h2 - 8, {align:'right'});
      }
      return pdf;
    }).save().then(function(){
      showPdfProgress('Succès !', 'Fichier prêt au téléchargement', 100);
      setTimeout(function(){
        hidePdfProgress();
        restoreOverlays(was);
        showToast('✓ PDF enregistré : ' + filename);
      }, 1000);
    }).catch(function(err){
      hidePdfProgress();
      restoreOverlays(was);
      showToast('⚠ Erreur PDF. Utilisez le bouton Imprimer à la place.');
      console.error('html2pdf error:', err);
    });
  });
}


/* ═══════════════════════════════════════════════
   ZOOM ÉDITEUR
   setZoom(delta) : delta=0 → reset à 100%
   delta=10 → +10%, delta=-10 → -10%
   Range : 60% → 150%
═══════════════════════════════════════════════ */
var _zoom = 100;
function setZoom(delta){
  if(delta === 0){ _zoom = 100; }
  else { _zoom = Math.max(60, Math.min(150, _zoom + delta)); }
  var page = document.getElementById('page');
  var lbl  = document.getElementById('zoom-label');
  if(page) page.style.transform = 'scale(' + _zoom/100 + ')';
  /* Ajuster la hauteur du wrapper pour éviter le chevauchement */
  if(page){
    var nat = page.offsetHeight;
    var wrap = document.getElementById('page-wrap');
    if(wrap) wrap.style.paddingBottom = Math.round(nat * (_zoom/100 - 1) + 24) + 'px';
  }
  if(lbl) lbl.textContent = _zoom + '%';
  showToast(_zoom === 100 ? 'Zoom réinitialisé (100%)' : 'Zoom : ' + _zoom + '%');
}

/* Raccourcis Ctrl+= Ctrl+- Ctrl+0 */
document.addEventListener('keydown', function(e){
  if(!e.ctrlKey) return;
  if(e.key === '=' || e.key === '+'){e.preventDefault();setZoom(10);}
  else if(e.key === '-'){e.preventDefault();setZoom(-10);}
  else if(e.key === '0'){e.preventDefault();setZoom(0);}
});

window.addEventListener('beforeunload',function(){
  if(!S.submitted){autoSave();SCORM.finish();}
});

/* ═══════════════════════════════════════════════
   PAUSE & DICTÉE — Nouvelles Fonctions
═══════════════════════════════════════════════ */
function togglePause() {
  if (S.submitted) return;
  _isPaused = !_isPaused;
  const overlay = document.getElementById('pause-overlay');
  const ed = document.getElementById('ed');
  const config = SCORM.getConfig();
  
  if (_isPaused) {
    overlay.style.display = 'flex';
    lockEd(true);
    log('PAUSE','Début de la pause autorisée.','p');
    _pauseTimer = setInterval(function() {
      _pauseTimeleft--;
      updatePauseUI();
      if (_pauseTimeleft <= 0) togglePause();
    }, 1000);
  } else {
    overlay.style.display = 'none';
    lockEd(false);
    log('PAUSE','Fin de la pause. Reprise du travail.','p');
    clearInterval(_pauseTimer);
    _pauseTimeleft = (config.pedagogy.authorizedPauseDuration / 1000) || 300;
    updatePauseUI();
  }
}

function updatePauseUI() {
  const m = Math.floor(_pauseTimeleft / 60);
  const s = _pauseTimeleft % 60;
  var timerEl = document.getElementById('pause-timer');
  if(timerEl) timerEl.textContent = pad(m) + ':' + pad(s);
}


function insertTextAtCursor(text) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
  onCh();
}

/* ═══════════════════════════════════════════════
   EXPOSITION DE L'API PUBLIQUE (POUR HTML)
═══════════════════════════════════════════════ */
window.applyColor=applyColor;
window.applyFont=applyFont;
window.applySize=applySize;
window.blockCopy=blockCopy;
window.blockPaste=blockPaste;
window.checkStartReady=checkStartReady;
window.closeModal=closeModal;
window.confirmSub=confirmSub;
window.doSubmit=doSubmit;
window.exportPDF=exportPDF;
window.finishRes=finishRes;
window.fmt=fmt;
window.hideBanner=hideBanner;
window.importPlagiatFile=importPlagiatFile;
window.ins=ins;
window.manualSave=manualSave;
window.onCh=onCh;
window.restoreDraftLocal=restoreDraftLocal;
window.clearDraftLocal=clearDraftLocal;
window.confirmClearDraft=confirmClearDraft;
window.printDoc=printDoc;
window.testCameraPreflight=testCameraPreflight;
window.testScreenPreflight=testScreenPreflight;
window.toggleScreenBtn=toggleScreenBtn;
window.startExamReal=startExamReal;
window.openRes=openRes;
window.setZoom=setZoom;
window.swP=swP;
window.toggleFS=toggleFS;
window.toggleFocus=toggleFocus;
window.togglePause=togglePause;
window.toggleTTS=toggleTTS;
window.updTb=updTb;
window.log=log;
window.capturePhoto=capturePhoto;
window.triggerImport=triggerImport;
window.getCameraStream = function() { return _camStream; };
window.playBip = _bip;
window.isAIAllowed = function() { return _monitoringActive && !_isPaused && !S.submitted; };

// Lancement automatique des vérifications initiales
checkDraftOnLoad();
_monitoringActive = true;
console.log("🛡️ Moteur de surveillance initialisé.");
if(typeof checkStartReady === 'function') checkStartReady();

})(); // FIN DE L'IIFE DE PROTECTION
