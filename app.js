// --- CONFIGURATION FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyDVvRxbKqlck7-V5uDZcsGqYXx7rEmMt4g",
  authDomain: "rochersaintpierre1h.firebaseapp.com",
  projectId: "rochersaintpierre1h",
  storageBucket: "rochersaintpierre1h.firebasestorage.app",
  messagingSenderId: "12413486620",
  appId: "1:12413486620:web:baede780cf1e204dc681d9"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

function app() {
  return {
    tab: 'calendrier',
    syncStatus: 'synced',
    isAuthenticated: false,
    loginEmail: '',
    loginPassword: '',
    showPassword: false,
    loginError: '',
    lastBookingSync: '',
    autoSyncBookingStarted: false,
    
    currentYear: (new Date().getMonth() >= 8) ? new Date().getFullYear() + 1 : new Date().getFullYear(),
    
    donnees: { pctBooking: 19, pctAcompte: 30, prixMenage: 75, taxeSejour: 1.65, prixReelMenage: 60, prixRemiseCle: 60, fermetures: [], urlBookingIcal: '' },
    reservations: [],
    gridTarifs: {},
    comptaData: {},
    calendarMonths: [],
    
    showModalClient: false,
    showModalNew: false,
    showModalEdit: false,
    selectedRes: null,
    isLoaded: false,
    saveTimeout: null,
    
    form: { nom: '', prenom: '', origine: 'booking', kitBebe: 'non', dateDebut: '', dateFin: '', nbAdulte: 1, nbEnfant: 0, telephone: '', email: '', adresse: '', codePostal: '', ville: '', pays: 'France' },
    editForm: { id: null, nom: '', prenom: '', origine: 'booking', kitBebe: 'non', dateDebut: '', dateFin: '', nbAdulte: 1, nbEnfant: 0, telephone: '', email: '', adresse: '', codePostal: '', ville: '', pays: 'France' },

    // --- AUTHENTIFICATION ---
    initData() {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          this.isAuthenticated = true;
          this.loadFirebaseData();
        } else {
          this.isAuthenticated = false;
        }
      });
      this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
    },

    login() {
      this.loginError = '';
      firebase.auth().signInWithEmailAndPassword(this.loginEmail.trim(), this.loginPassword)
        .catch((err) => { 
            console.error(err);
            this.loginError = "Code Erreur : " + err.code; 
        });
    },
    logout() { firebase.auth().signOut(); },

    // --- CHARGEMENT FIREBASE AVEC ALERTES DE SÉCURITÉ ---
    loadFirebaseData() {
      db.collection("locations").doc("rocher1H").onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          if (data.donnees) this.donnees = data.donnees;
          if (data.gridTarifs) this.gridTarifs = data.gridTarifs;
          if (data.comptaData) this.comptaData = data.comptaData;
          this.isLoaded = true;
          this.renderCalendar();
          this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });

          if (!this.autoSyncBookingStarted) {
            this.autoSyncBookingStarted = true;
            setTimeout(() => { this.syncBookingICal(false); }, 3000);
            setInterval(() => { this.syncBookingICal(false); }, 7200000);
          }
        }
      }, (error) => {
          alert("ERREUR FIREBASE (Données) : Vérifiez vos règles Firestore.\n" + error.message);
      });

      db.collection("locations").doc("rocher1H").collection("reservations").onSnapshot((snapshot) => {
        const resas = [];
        snapshot.forEach((doc) => resas.push(doc.data()));
        this.reservations = resas;
        this.cleanDuplicates();
        this.syncCustomReservationLines();
        this.recalculateAllReservations();
        this.renderCalendar();
      }, (error) => {
          alert("ERREUR FIREBASE (Réservations) : Vérifiez vos règles Firestore.\n" + error.message);
      });
    },

    saveAll() {
      if (!this.isLoaded) return;
      this.syncStatus = 'saving';
      clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => {
        const dataToSave = { donnees: this.donnees, gridTarifs: this.gridTarifs, comptaData: this.comptaData };
        db.collection("locations").doc("rocher1H").set(JSON.parse(JSON.stringify(dataToSave)), { merge: true })
          .then(() => { this.syncStatus = 'synced'; })
          .catch((e) => { 
              console.error(e); 
              this.syncStatus = 'error'; 
              alert("Erreur Sauvegarde Firebase : " + e.message);
          });
      }, 800);
    },

    cleanDuplicates() {
      const seen = new Set();
      const toDeleteIds = [];
      this.reservations = this.reservations.filter(r => {
        const key = r.bookingUid ? `uid_${r.bookingUid}` : `${(r.nom||'').trim()}_${r.dateDebut}_${r.dateFin}`;
        if (seen.has(key)) { toDeleteIds.push(r.id); return false; }
        seen.add(key); return true;
      });
      toDeleteIds.forEach(id => {
        db.collection("locations").doc("rocher1H").collection("reservations").doc(String(id)).delete().catch(() => {});
      });
    },

    // --- SYNCHRO BOOKING ICAL VIA CORSPROXY.IO ---
    async syncBookingICal(manual = false) {
      const targetUrl = "https://ical.booking.com/v1/export?t=c2d66752-1786-44bf-8335-c13a782af04b";

      try {
        const separator = targetUrl.includes('?') ? '&' : '?';
        const finalBookingUrl = targetUrl + separator + "v=" + Date.now();
        // Proxy 100% fiable pour le Web
        const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(finalBookingUrl);

        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("Le proxy a rejeté la demande (" + res.status + ")");
        
        const text = await res.text();
        const events = this.parseICSBooking(text);
        
        const maxAllowedYear = new Date().getFullYear() + 1;
        const validEvents = events.filter(evt => parseInt(evt.start.split('-')[0], 10) <= maxAllowedYear);
        let nbrNouveaux = 0, nbrModifies = 0;

        validEvents.forEach(evt => {
          let existingRes = this.reservations.find(r => r.bookingUid === evt.uid || ((r.origine === 'booking' || r.codeTarif === 'booking') && r.dateDebut === evt.start && r.dateFin === evt.end));
          if (existingRes) {
            existingRes.bookingUid = evt.uid;
            if (existingRes.dateDebut !== evt.start || existingRes.dateFin !== evt.end) {
              existingRes.dateDebut = evt.start; existingRes.dateFin = evt.end;
              existingRes.prixTotal = this.calculateStayPrice(evt.start, evt.end, existingRes.codeTarif);
              db.collection("locations").doc("rocher1H").collection("reservations").doc(String(existingRes.id)).set(existingRes);
              nbrModifies++;
            }
          } else {
            const newRes = {
              id: Date.now() + Math.floor(Math.random() * 10000), bookingUid: evt.uid, nom: 'Client', prenom: 'Booking.com', origine: 'booking', codeTarif: 'booking',
              dateDebut: evt.start, dateFin: evt.end, kitBebe: 'non', nbAdulte: 2, nbEnfant: 0, acompte: 0, soldePaye: 0, cautionRecue: 'non', cautionRendue: 'non', forceMenageNon: 'non', prixTotal: 0
            };
            newRes.prixTotal = this.calculateStayPrice(newRes.dateDebut, newRes.dateFin, newRes.codeTarif);
            this.reservations.push(newRes);
            db.collection("locations").doc("rocher1H").collection("reservations").doc(String(newRes.id)).set(newRes);
            nbrNouveaux++;
          }
        });

        const d = new Date();
        this.lastBookingSync = String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');

        if (nbrNouveaux > 0 || nbrModifies > 0) {
          this.syncCustomReservationLines();
          this.renderCalendar();
          if (manual) alert(`SUCCÈS : ${nbrNouveaux} réservation(s) ajoutée(s) et ${nbrModifies} modifiée(s).`);
        } else if (manual) {
          alert("Aucune nouvelle réservation trouvée sur Booking.com.");
        }
      } catch (err) { 
        if (manual) alert("Erreur de synchronisation Web : " + err.message); 
      }
    },

    parseICSBooking(texte) {
      if (!texte) return [];
      const events = [], lignes = texte.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
      let start = null, end = null, uid = null;
      lignes.forEach(line => {
        line = line.trim();
        if (line.startsWith("UID:")) uid = line.substring(4).trim();
        else if (line.startsWith("DTSTART")) { const m = line.match(/\d{8}/); if (m) start = `${m[0].substring(0,4)}-${m[0].substring(4,6)}-${m[0].substring(6,8)}`; }
        else if (line.startsWith("DTEND")) { const m = line.match(/\d{8}/); if (m) end = `${m[0].substring(0,4)}-${m[0].substring(4,6)}-${m[0].substring(6,8)}`; }
        else if (line.startsWith("END:VEVENT")) { if (start && end) events.push({ uid: uid || `${start}_${end}`, start, end }); start = null; end = null; uid = null; }
      });
      return events;
    },

    // --- UTILS & FORMULES ---
    switchTab(tabName) { this.tab = tabName; this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); }); },
    changeGlobalYear(delta) { this.currentYear += delta; this.renderCalendar(); },
    formatCurrency(val) { return (Number(val) || 0).toFixed(2) + ' €'; },
    formatDate(dStr) { return !dStr ? '' : `${dStr.split('-')[2]}/${dStr.split('-')[1]}/${dStr.split('-')[0]}`; },
    calcNights(start, end) { return (!start || !end) ? 0 : Math.max(0, Math.round((new Date(end.split('-')[0], end.split('-')[1] - 1, end.split('-')[2]) - new Date(start.split('-')[0], start.split('-')[1] - 1, start.split('-')[2])) / (1000 * 60 * 60 * 24))); },
    isPerso(res) { if (!res) return false; const name = (res.nom + ' ' + (res.prenom || '')).toLowerCase().trim(); return name === 'indispo perso'; },
    
    isRefundable(dateStr) {
      if (!dateStr) return false;
      const [y, m, d] = dateStr.split('-').map(Number);
      const limit = new Date(y, m - 1, d);
      limit.setDate(limit.getDate() - 30);
      const today = new Date();
      today.setHours(0,0,0,0);
      limit.setHours(0,0,0,0);
      return today <= limit;
    },

    getReservationStatus(res) {
      if (!res) return 'option';
      if (this.isPerso(res) || res.codeTarif === 'booking' || res.origine === 'booking') return 'confirme';
      return ((Number(res.acompte) || 0) > 0 || (Number(res.soldePaye) || 0) > 0) ? 'confirme' : 'option';
    },

    // --- FORMULAIRES ---
    openModalNewRes() {
      this.form = { nom: '', prenom: '', origine: 'booking', kitBebe: 'non', dateDebut: '', dateFin: '', nbAdulte: 1, nbEnfant: 0, telephone: '', email: '', adresse: '', codePostal: '', ville: '', pays: 'France' };
      this.showModalNew = true;
    },
    submitReservation() {
      if (this.form.dateFin <= this.form.dateDebut) return alert('La date de départ doit être après l\'arrivée.');
      const newRes = { id: Date.now(), codeTarif: 'public', acompte: 0, soldePaye: 0, cautionRecue: 'non', cautionRendue: 'non', forceMenageNon: 'non', ...this.form };
      newRes.prixTotal = this.calculateStayPrice(newRes.dateDebut, newRes.dateFin, newRes.codeTarif);
      this.reservations.push(newRes);
      db.collection("locations").doc("rocher1H").collection("reservations").doc(String(newRes.id)).set(newRes);
      this.syncCustomReservationLines();
      this.saveAll(); 
      this.renderCalendar();
      this.showModalNew = false; 
    },
    
    openModalEditRes(res) {
      this.editForm = { ...res };
      this.showModalEdit = true;
    },
    submitEditReservation() {
      if (this.editForm.dateFin <= this.editForm.dateDebut) return alert('La date de départ doit être après l\'arrivée.');
      this.editForm.prixTotal = this.calculateStayPrice(this.editForm.dateDebut, this.editForm.dateFin, this.editForm.codeTarif);
      const idx = this.reservations.findIndex(r => r.id === this.editForm.id);
      if (idx !== -1) this.reservations[idx] = { ...this.editForm };
      db.collection("locations").doc("rocher1H").collection("reservations").doc(String(this.editForm.id)).set(this.editForm);
      this.syncCustomReservationLines();
      this.saveAll(); 
      this.renderCalendar();
      this.showModalEdit = false; 
    },
    deleteReservation(id) {
      if (confirm('Voulez-vous vraiment supprimer cette réservation ?')) {
        this.reservations = this.reservations.filter(r => r.id !== id);
        db.collection("locations").doc("rocher1H").collection("reservations").doc(String(id)).delete();
        this.syncCustomReservationLines();
        this.saveAll(); 
      }
    },

    // --- CALCULS SÉJOURS ---
    get filteredReservationsByYear() { return this.reservations.filter(r => r.dateDebut && r.dateDebut.startsWith(String(this.currentYear))).sort((a, b) => a.dateDebut.localeCompare(b.dateDebut)); },
    get filteredGridTarifs() { return Object.values(this.gridTarifs).filter(r => r.startISO && r.startISO.startsWith(String(this.currentYear))).sort((a, b) => a.startISO.localeCompare(b.startISO)); },
    getReservationForTarif(w) { if (w.isCustom) return null; return this.reservations.find(r => r.dateDebut && r.dateFin && w.startISO >= r.dateDebut && w.endISO <= r.dateFin); },
    getTarifRowForStay(dateDebut, dateFin) {
      const customKey = `CUST-${dateDebut}_${dateFin}`;
      if (this.gridTarifs[customKey]) return this.gridTarifs[customKey];
      const rows = Object.values(this.gridTarifs);
      for (let r of rows) if (r.startISO === dateDebut && r.endISO === dateFin) return r;
      for (let r of rows) if (dateDebut >= r.startISO && dateDebut < r.endISO) return r;
      return { public: 400, booking: 550, correction: 550, libre: 0 };
    },
    calculateStayPrice(dateDebut, dateFin, codeTarif) {
      if (!dateDebut || !dateFin) return 0;
      const row = this.getTarifRowForStay(dateDebut, dateFin);
      if (codeTarif === 'booking') return Number(row.correction) || Number(row.booking) || 0;
      if (['libre', 'perso', 'black'].includes(codeTarif)) return Number(row.libre) || 0;
      return Number(row.public) || 0;
    },
    updateReservationTarif(res) { res.prixTotal = this.calculateStayPrice(res.dateDebut, res.dateFin, res.codeTarif); this.saveAll(); },
    recalculateAllReservations() { this.reservations.forEach(r => { if (!r.codeTarif) r.codeTarif = 'public'; r.prixTotal = this.calculateStayPrice(r.dateDebut, r.dateFin, r.codeTarif); }); },

    calcMenage(res) { return (!res || res.forceMenageNon === 'oui' || res.codeTarif === 'perso') ? 0 : (['public', 'libre', 'black'].includes(res.codeTarif || 'public') ? (Number(this.donnees.prixMenage) || 0) : 0); },
    calcTaxeSejour(res) { return (!res || ['perso', 'black', 'booking'].includes(res.codeTarif || 'public')) ? 0 : (this.calcNights(res.dateDebut, res.dateFin) * (Number(res.nbAdulte) || 0) * (Number(this.donnees.taxeSejour) || 0)); },
    calcTotalSejour(res) { return !res ? 0 : (Number(res.prixTotal) || 0) + this.calcMenage(res) + this.calcTaxeSejour(res); },
    calcAcompte(res) { if (!res) return 0; const pct = (Number(this.donnees.pctAcompte) || 30) / 100; return Math.ceil((Number(res.prixTotal) || 0) * pct); },
    calcResteAPayer(res) { return !res ? 0 : Math.max(0, this.calcTotalSejour(res) - (Number(res.acompte) || 0) - (Number(res.soldePaye) || 0)); },

    // --- GRILLE TARIFS ---
    updateAllBookingTarifs() {
      Object.keys(this.gridTarifs).forEach(k => {
        const r = this.gridTarifs[k]; r.booking = this.calculateBookingPrice(Number(r.public) || 0); if (!r.correction) r.correction = r.booking;
      }); this.onTarifChange();
    },
    calculateBookingPrice(pub) { if (!pub) return 0; const pct = Number(this.donnees.pctBooking) || 0; const men = Number(this.donnees.prixMenage) || 0; return Math.round((pub * (1 + (pct / 100)) + men) / 10) * 10; },
    recalcRowBooking(row) { row.booking = this.calculateBookingPrice(Number(row.public) || 0); row.correction = row.booking; this.onTarifChange(); },
    onTarifChange() { this.saveAll(); this.recalculateAllReservations(); },
    syncCustomReservationLines() {
      let changed = false;
      Object.keys(this.gridTarifs).forEach(key => {
        if (key.startsWith('CUST-') && !this.reservations.some(r => `CUST-${r.dateDebut}_${r.dateFin}` === key)) { delete this.gridTarifs[key]; changed = true; }
      });
      this.reservations.forEach(res => {
        if (!res.dateDebut || !res.dateFin) return;
        const nuits = this.calcNights(res.dateDebut, res.dateFin);
        const [y1, m1, d1] = res.dateDebut.split('-').map(Number);
        const [y2, m2, d2] = res.dateFin.split('-').map(Number);
        const isStandard = (new Date(y1, m1 - 1, d1).getDay() === 6 && new Date(y2, m2 - 1, d2).getDay() === 6 && nuits % 7 === 0);
        
        if (!isStandard) {
          const key = `CUST-${res.dateDebut}_${res.dateFin}`;
          if (!this.gridTarifs[key]) {
            const defPub = Math.round((400 / 7) * nuits);
            const bk = this.calculateBookingPrice(defPub);
            this.gridTarifs[key] = { key, label: `${res.nom} ${res.prenom||''}`, isCustom: true, public: defPub, booking: bk, correction: bk, libre: 0, startISO: res.dateDebut, endISO: res.dateFin };
            changed = true;
          }
        }
      });
      if (changed) this.saveAll();
    },

    // --- CALENDRIER ---
    isDateClosed(dateStr) { return this.donnees.fermetures && this.donnees.fermetures.some(f => f.debut && f.fin && dateStr >= f.debut && dateStr <= f.fin); },
    getColorForRes(res, isClosed) {
      if (isClosed) return '#e2e8f0'; 
      if (!res) return 'rgba(52, 211, 153, 0.3)'; 
      if (this.isPerso(res)) return 'rgba(96, 165, 250, 0.4)'; 
      if (this.getReservationStatus(res) === 'option') return 'rgba(251, 191, 36, 0.4)'; 
      return 'rgba(248, 113, 113, 0.4)'; 
    },
    getDayTooltip(day) {
      if (day.isClosed) return 'Fermé';
      if (!day.resMatin && !day.resAprem) return 'Libre';
      if (day.resMatin && day.resAprem && day.resMatin.id === day.resAprem.id) {
        const res = day.resMatin;
        const statut = this.isPerso(res) ? 'Perso' : (this.getReservationStatus(res) === 'confirme' ? 'Confirmé' : 'Option');
        return `${statut} : ${res.nom} ${res.prenom || ''}`;
      }
      let tMatin = day.resMatin ? `${this.isPerso(day.resMatin) ? 'Perso' : day.resMatin.nom}` : 'Libre';
      let tAprem = day.resAprem ? `${this.isPerso(day.resAprem) ? 'Perso' : day.resAprem.nom}` : 'Libre';
      return `Matin : ${tMatin} \nAprem : ${tAprem}`;
    },
    openClientCard(dayOrRes) {
      if (dayOrRes.isClosed) return;
      const res = dayOrRes.resAprem || dayOrRes.resMatin || dayOrRes;
      if (res && res.id) { this.selectedRes = res; this.showModalClient = true; }
    },
    renderCalendar() {
      const months = [];
      for (let m = 0; m < 12; m++) {
        const date = new Date(this.currentYear, m, 1);
        let firstDayIndex = date.getDay() - 1; if (firstDayIndex === -1) firstDayIndex = 6;
        const daysArr = [];
        for (let d = 1; d <= new Date(this.currentYear, m + 1, 0).getDate(); d++) {
          const currentDayStr = `${this.currentYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const resMatin = this.reservations.find(r => currentDayStr > r.dateDebut && currentDayStr <= r.dateFin);
          const resAprem = this.reservations.find(r => currentDayStr >= r.dateDebut && currentDayStr < r.dateFin);
          daysArr.push({ dayNum: d, dateStr: currentDayStr, resMatin: resMatin || null, resAprem: resAprem || null, isClosed: this.isDateClosed(currentDayStr) });
        }
        months.push({ name: date.toLocaleString('fr-FR', { month: 'long' }), padding: firstDayIndex, days: daysArr });
      }
      this.calendarMonths = months;

      let d = new Date(this.currentYear, 0, 1);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      let wNum = 1;
      while (d.getFullYear() <= this.currentYear && wNum <= 52) {
        const start = new Date(d); const end = new Date(d); end.setDate(end.getDate() + 7);
        const key = `STD-${this.currentYear}-W${String(wNum).padStart(2, '0')}`;
        const startISO = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        if (!this.gridTarifs[key]) {
          const bk = this.calculateBookingPrice(400);
          this.gridTarifs[key] = { key, label: 'Semaine ' + wNum, isCustom: false, public: 400, booking: bk, correction: bk, libre: 0, startISO, endISO };
        } else {
          this.gridTarifs[key].startISO = startISO; this.gridTarifs[key].endISO = endISO;
        }
        d.setDate(d.getDate() + 7); wNum++;
      }
    },

    // --- COMPTABILITÉ COMPLÈTE ---
    getComptaYearData(yr) {
      const key = String(yr);
      if (!this.comptaData[key]) {
        this.comptaData[key] = { 
          menageEnPlus: 0, taxePayee: 0, taxeARetirer: 0, 
          paiementConciergerie1: 0, paiementConciergerie2: 0, paiementConciergerie3: 0, paiementConciergerie4: 0,
          rambaudT1: 0, rambaudT2: 0, rambaudT3: 0, rambaudT4: 0, rambaudReliquat: 0, 
          sorea1: 0, sorea2: 0, sorea3: 0, sorea4: 0, sorea5: 0, 
          forfait: 0, centralResa: 0, taxeFonciere: 0, taxeHabitation: 0, 
          assuranceAppart: 0, assuranceCredit: 0, internet: 251.88, 
          autreNom1: '', autreMontant1: 0, autreNom2: '', autreMontant2: 0, autreNom3: '', autreMontant3: 0, 
          impotAbattementPct: 50, impotTauxIRPct: 30, impotTauxCSGPct: 17.2 
        };
      }
      return this.comptaData[key];
    }, 
    
    get comptaMetrics() {
      const yr = String(this.currentYear);
      const yearRes = this.reservations.filter(r => r.dateDebut && r.dateDebut.startsWith(yr));
      const totalGainBrut = yearRes.reduce((sum, r) => sum + this.calcTotalSejour(r), 0);
      const totalOfficiel = yearRes.filter(r => !['black', 'perso'].includes(String(r.codeTarif).toLowerCase().trim())).reduce((sum, r) => sum + this.calcTotalSejour(r), 0);
      const taxeCalculer = yearRes.reduce((sum, r) => sum + this.calcTaxeSejour(r), 0);
      const paiementsRecus = yearRes.reduce((sum, r) => sum + (Number(r.acompte) || 0) + (Number(r.soldePaye) || 0), 0);
      const paiementsARecevoir = yearRes.reduce((sum, r) => sum + this.calcResteAPayer(r), 0);
      const menageEnPlus = Number(this.getComptaYearData(yr).menageEnPlus) || 0;
      const nbMenages = yearRes.filter(r => String(r.forceMenageNon).toLowerCase().trim() !== 'oui').length;
      const nbRemiseCles = yearRes.filter(r => String(r.codeTarif).toLowerCase().trim() !== 'perso' && String(r.origine).toLowerCase().trim() !== 'perso').length;
      const coutTotalConciergerie = ((nbMenages + menageEnPlus) * (Number(this.donnees.prixReelMenage) || 60)) + (nbRemiseCles * (Number(this.donnees.prixRemiseCle) || 60));
      return { totalGainBrut, totalOfficiel, taxeCalculer, paiementsRecus, paiementsARecevoir, nbMenages, totalMenagesConciergerie: nbMenages + menageEnPlus, nbRemiseCles, coutTotalConciergerie };
    },

    get comptaTotalRambaud() { const d = this.getComptaYearData(this.currentYear); return (Number(d.rambaudT1)||0) + (Number(d.rambaudT2)||0) + (Number(d.rambaudT3)||0) + (Number(d.rambaudT4)||0) + (Number(d.rambaudReliquat)||0); },
    get comptaTotalSorea() { const d = this.getComptaYearData(this.currentYear); return (Number(d.sorea1)||0) + (Number(d.sorea2)||0) + (Number(d.sorea3)||0) + (Number(d.sorea4)||0) + (Number(d.sorea5)||0); },
    get comptaTotalTaxesDirectes() { const d = this.getComptaYearData(this.currentYear); return (Number(d.taxeFonciere)||0) + (Number(d.taxeHabitation)||0); },
    get comptaTotalAutres() { const d = this.getComptaYearData(this.currentYear); return (Number(d.autreMontant1)||0) + (Number(d.autreMontant2)||0) + (Number(d.autreMontant3)||0); },
    
    get comptaTotalGeneralCharges() {
      const d = this.getComptaYearData(this.currentYear);
      return this.comptaMetrics.taxeCalculer + this.comptaMetrics.coutTotalConciergerie + (Number(d.assuranceAppart)||0) + (Number(d.assuranceCredit)||0) + this.comptaTotalRambaud + this.comptaTotalSorea + this.comptaTotalTaxesDirectes + (Number(d.forfait)||0) + (Number(d.centralResa)||0) + (Number(d.internet)||0) + this.comptaTotalAutres;
    },
    
    get comptaTaxeRestante() { const d = this.getComptaYearData(this.currentYear); return Math.max(0, this.comptaMetrics.taxeCalculer - (Number(d.taxePayee)||0) - (Number(d.taxeARetirer)||0)); },
    get comptaRestantTotal() { return this.comptaMetrics.totalGainBrut - this.comptaTotalGeneralCharges; },
    get comptaPourcentageRatio() { return this.comptaTotalGeneralCharges === 0 ? 0 : (this.comptaMetrics.totalGainBrut / this.comptaTotalGeneralCharges) * 100; },
    get comptaCreditAnnuel() { return 5551.20; },
    get comptaCreditReste() { return this.comptaCreditAnnuel - this.comptaRestantTotal; },
    get comptaCreditFinancePourcentage() { return 100 - ((this.comptaCreditReste / this.comptaCreditAnnuel) * 100); },
    get comptaCreditRestePersMois() { return this.comptaCreditReste / 24; }
  };
}