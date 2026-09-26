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
if (typeof db.enablePersistence === 'function') {
  db.enablePersistence({ synchronizeTabs: true }).catch(err => console.warn("Cache hors-ligne :", err.message));
}

function app() {
  return {
    tab: 'calendrier',
    syncStatus: 'synced',
    lastBookingSync: '',
    isAuthenticated: false,
    loginEmail: '',
    loginPassword: '',
    showPassword: false,
    loginError: '',

    login() {
      this.loginError = '';
      if (!this.loginEmail || !this.loginPassword) {
        this.loginError = "Veuillez remplir tous les champs.";
        return;
      }

      firebase.auth().signInWithEmailAndPassword(this.loginEmail, this.loginPassword)
        .then(() => {
          this.isAuthenticated = true;
          localStorage.setItem('hasSession', 'true');
          this.loginEmail = '';
          this.loginPassword = '';
        })
        .catch((error) => {
          console.error("Erreur de connexion :", error);
          this.loginError = "Email ou mot de passe incorrect.";
        });
    },

    logout() {
      firebase.auth().signOut().then(() => {
        localStorage.removeItem('hasSession');
        this.isAuthenticated = false;
        this.isLoaded = false;
      }).catch(err => console.error("Erreur de déconnexion :", err));
    },

    currentYear: (new Date().getMonth() >= 8) ? new Date().getFullYear() + 1 : new Date().getFullYear(),
    todayYear: new Date().getFullYear(),
    selectedDocResId: null,
    docType: 'contrat',
    calendarMonths: [],
    gridTarifs: {},
    comptaData: {},
    showModalNew: false,
    showModalEdit: false,
    showModalClient: false,
    showModalClientsList: false,
    selectedRes: null,

    donnees: { 
      nomConciergerie: '', 
      pctBooking: 19, 
      pctAcompte: 30, 
      prixMenage: 75, 
      taxeSejour: 1.65, 
      prixReelMenage: 60, 
      prixRemiseCle: 60, 
      fermetures: [{debut:'', fin:''}, {debut:'', fin:''}, {debut:'', fin:''}, {debut:'', fin:''}] 
    },
    reservations: [],

    form: { nom: '', prenom: '', origine: 'booking', kitBebe: 'non', dateDebut: '', dateFin: '', nbAdulte: 1, nbEnfant: 0, telephone: '', email: '', adresse: '', codePostal: '', ville: '', pays: 'France' },
    editForm: { id: null, nom: '', prenom: '', origine: 'booking', kitBebe: 'non', dateDebut: '', dateFin: '', nbAdulte: 1, nbEnfant: 0, telephone: '', email: '', adresse: '', codePostal: '', ville: '', pays: 'France' },
    isLoaded: false,
    saveTimeout: null,

    loadLocalBackup() {
      try {
        const raw = localStorage.getItem('rocher_app_data');
        if (raw) {
          const data = JSON.parse(raw);
          if (data.donnees) this.donnees = data.donnees;
          if (data.gridTarifs) this.gridTarifs = data.gridTarifs;
          if (data.comptaData) this.comptaData = data.comptaData;
          if (Array.isArray(data.reservations) && data.reservations.length > 0) {
            this.reservations = data.reservations;
          }
          this.isLoaded = true;
          this.syncCustomReservationLines();
          this.recalculateAllReservations();
          this.renderCalendar();
        }
      } catch (e) {
        console.warn("Erreur chargement backup local :", e);
      }
    },

    saveLocalBackup() {
      try {
        const state = {
          donnees: this.donnees,
          gridTarifs: this.gridTarifs,
          comptaData: this.comptaData,
          reservations: this.reservations || []
        };
        localStorage.setItem('rocher_app_data', JSON.stringify(state));
        localStorage.setItem('hasSession', 'true');
      } catch (e) {
        console.warn("Erreur enregistrement backup local :", e);
      }
    },

    initData() {
      this.loadLocalBackup();

      if (localStorage.getItem('hasSession') === 'true') {
        this.isAuthenticated = true;
        this.isLoaded = true;
      }

      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          localStorage.setItem('hasSession', 'true');
          this.isAuthenticated = true;
          this.loadFirebaseData();
        } else {
          if (localStorage.getItem('hasSession') !== 'true') {
            this.isAuthenticated = false;
            this.isLoaded = true;
          }
        }
      });
    },

    cleanDuplicates() {
      const seen = new Set();
      const toDeleteIds = [];

      this.reservations = this.reservations.filter(r => {
        const key = r.bookingUid 
          ? `uid_${r.bookingUid}` 
          : `${(r.nom||'').trim().toLowerCase()}_${(r.prenom||'').trim().toLowerCase()}_${r.dateDebut}_${r.dateFin}`;
        
        if (seen.has(key)) {
          toDeleteIds.push(r.id);
          return false;
        }
        seen.add(key);
        return true;
      });

      toDeleteIds.forEach(id => {
        db.collection("locations").doc("rocher1H").collection("reservations").doc(String(id)).delete().catch(() => {});
      });
    },

    loadFirebaseData() {
      db.collection("locations").doc("rocher1H").onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          if (data.donnees) this.donnees = data.donnees;
          if (data.gridTarifs) this.gridTarifs = data.gridTarifs;
          if (data.comptaData) this.comptaData = data.comptaData;
          
          if (data.reservations) {
            db.collection("locations").doc("rocher1H").update({
              reservations: firebase.firestore.FieldValue.delete()
            }).catch(() => {});
          }
          
          this.isLoaded = true;
          this.saveLocalBackup();
          this.renderCalendar();
          this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });

          if (!this.autoSyncBookingStarted && this.donnees && this.donnees.urlBookingIcal) {
            this.autoSyncBookingStarted = true;
            setTimeout(() => { this.syncBookingICal(false); }, 3000);
            setInterval(() => { this.syncBookingICal(false); }, 7200000);
          }
        }
      }, (err) => console.warn("Erreur config Firebase :", err.message));

      db.collection("locations").doc("rocher1H").collection("reservations").onSnapshot((snapshot) => {
        const resas = [];
        snapshot.forEach((doc) => { resas.push(doc.data()); });
        this.reservations = resas;
        
        this.cleanDuplicates();
        this.saveLocalBackup();
        this.syncCustomReservationLines();
        this.recalculateAllReservations();
        this.renderCalendar();
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }, (err) => console.error("Erreur lecture résas :", err));
    },

    syncCustomReservationLines() {
      let changed = false;

      Object.keys(this.gridTarifs).forEach(key => {
        if (key.startsWith('CUST-')) {
          const resExists = this.reservations.some(r => `CUST-${r.dateDebut}_${r.dateFin}` === key);
          if (!resExists) {
            delete this.gridTarifs[key];
            changed = true;
          }
        }
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
            const defaultPublic = Math.round((400 / 7) * nuits);
            const bookingVal = this.calculateBookingPrice(defaultPublic);
            this.gridTarifs[key] = { 
              key, 
              label: `${res.nom} ${res.prenom}`, 
              isCustom: true, 
              public: defaultPublic, 
              booking: bookingVal, 
              correction: bookingVal, 
              libre: 0, 
              startISO: res.dateDebut, 
              endISO: res.dateFin 
            };
            changed = true;
          }
        }
      });

      if (changed) this.saveAll();
    },

    saveAll() {
      if (!this.isLoaded) return;
      this.syncStatus = 'saving';
      this.saveLocalBackup();

      clearTimeout(this.saveTimeout);
      this.saveTimeout = setTimeout(() => {
        const dataToSave = {
          donnees: this.donnees,
          gridTarifs: this.gridTarifs,
          comptaData: this.comptaData
        };
        const cleanData = JSON.parse(JSON.stringify(dataToSave));

        db.collection("locations").doc("rocher1H").set(cleanData, { merge: true })
          .then(() => { this.syncStatus = 'synced'; })
          .catch(e => { console.error("Erreur Firestore :", e); this.syncStatus = 'error'; });
      }, 800);
    },

    // --- SYNCHRONISATION BOOKING ICAL VIA FIREBASE CLOUD FUNCTION ---
    async syncBookingICal(manual = false) {
      if (!this.donnees.urlBookingIcal) {
        if (manual) alert("Veuillez renseigner le lien iCal Booking.com dans l'onglet Données.");
        return;
      }

      try {
        const separator = this.donnees.urlBookingIcal.includes('?') ? '&' : '?';
        const finalBookingUrl = this.donnees.urlBookingIcal + separator + "v=" + Date.now();
        
        // URL de la Cloud Function
        const cloudFunctionUrl = "https://us-central1-rochersaintpierre1h.cloudfunctions.net/getBookingIcal?url=" + encodeURIComponent(finalBookingUrl);

        const res = await fetch(cloudFunctionUrl);
        if (!res.ok) throw new Error("Impossible de télécharger le calendrier via la Cloud Function.");

        const text = await res.text();
        if (!text.includes("BEGIN:VCALENDAR")) {
          throw new Error("Le fichier récupéré n'est pas un calendrier valide.");
        }

        const events = this.parseICSBooking(text);
        
        const maxAllowedYear = new Date().getFullYear() + 1;
        const validEvents = events.filter(evt => {
          const evtYear = parseInt(evt.start.split('-')[0], 10);
          return evtYear <= maxAllowedYear;
        });

        this.cleanDuplicates();

        let nbrNouveaux = 0;
        let nbrModifies = 0;

        validEvents.forEach(evt => {
          let existingRes = this.reservations.find(r => 
            (r.bookingUid && r.bookingUid === evt.uid) ||
            ((r.origine === 'booking' || r.codeTarif === 'booking') && r.dateDebut === evt.start && r.dateFin === evt.end)
          );

          if (existingRes) {
            existingRes.bookingUid = evt.uid;
            if (existingRes.dateDebut !== evt.start || existingRes.dateFin !== evt.end) {
              existingRes.dateDebut = evt.start;
              existingRes.dateFin = evt.end;
              existingRes.prixTotal = this.calculateStayPrice(evt.start, evt.end, existingRes.codeTarif);
              db.collection("locations").doc("rocher1H").collection("reservations").doc(String(existingRes.id)).set(existingRes);
              nbrModifies++;
            }
          } else {
            const newRes = {
              id: Date.now() + Math.floor(Math.random() * 10000),
              bookingUid: evt.uid,
              nom: 'Client',
              prenom: 'Booking.com',
              origine: 'booking',
              codeTarif: 'booking',
              kitBebe: 'non',
              dateDebut: evt.start,
              dateFin: evt.end,
              nbAdulte: 2,
              nbEnfant: 0,
              telephone: '',
              email: '',
              adresse: '',
              codePostal: '',
              ville: '',
              pays: 'France',
              acompte: 0,
              soldePaye: 0,
              dateVirementAcompte: '',
              numVirementAcompte: '',
              dateVirementSolde: '',
              numVirementSolde: '',
              cautionRecue: 'non',
              cautionRendue: 'non',
              forceMenageNon: 'non',
              prixTotal: 0
            };
            newRes.prixTotal = this.calculateStayPrice(newRes.dateDebut, newRes.dateFin, newRes.codeTarif);
            
            this.reservations.push(newRes);
            db.collection("locations").doc("rocher1H").collection("reservations").doc(String(newRes.id)).set(newRes);
            nbrNouveaux++;
          }
        });

        this.cleanDuplicates();
        this.saveLocalBackup();

        const d = new Date();
        this.lastBookingSync = String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');

        if (nbrNouveaux > 0 || nbrModifies > 0) {
          this.syncCustomReservationLines();
          this.saveAll();
          this.renderCalendar();
          if (manual) alert(`SUCCÈS : ${nbrNouveaux} nouvelle(s) réservation(s) ajoutée(s) et ${nbrModifies} modifiée(s).`);
        } else if (manual) {
          alert("Aucune nouvelle réservation ou modification Booking.");
        }
      } catch (err) {
        console.error("Erreur synchro Booking :", err);
        const d = new Date();
        this.lastBookingSync = String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0') + " (Erreur)";
        if (manual) alert("Erreur lors de la synchronisation : " + err.message);
      }
    },

    parseICSBooking(texte) {
      const events = [];
      const texteDeplie = texte.replace(/\r?\n[ \t]/g, "");
      const lignes = texteDeplie.split(/\r?\n/);
      let start = null;
      let end = null;
      let uid = null;

      lignes.forEach(l => {
        const line = l.trim();
        if (line.startsWith("UID:")) {
          uid = line.substring(4).trim();
        } else if (line.startsWith("DTSTART")) {
          const m = line.match(/\d{8}/);
          if (m) {
            const d = m[0];
            start = `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
          }
        } else if (line.startsWith("DTEND")) {
          const m = line.match(/\d{8}/);
          if (m) {
            const d = m[0];
            end = `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
          }
        } else if (line.startsWith("END:VEVENT")) {
          if (start && end) {
            events.push({ uid: uid || `${start}_${end}`, start, end });
          }
          start = null;
          end = null;
          uid = null;
        }
      });
      return events;
    },

    exportData() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ donnees: this.donnees, gridTarifs: this.gridTarifs, reservations: this.reservations, comptaData: this.comptaData }, null, 2));
      const dl = document.createElement('a'); dl.setAttribute("href", dataStr); dl.setAttribute("download", `sauvegarde_rocher_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(dl); dl.click(); dl.remove();
    },

    importData(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (!imported.reservations || imported.reservations.length === 0) return alert("Aucune réservation trouvée.");

          if (confirm(`Importer et migrer ${imported.reservations.length} réservation(s) ?`)) {
            db.collection("locations").doc("rocher1H").set({
              donnees: imported.donnees || this.donnees,
              gridTarifs: imported.gridTarifs || this.gridTarifs,
              comptaData: imported.comptaData || this.comptaData
            }, { merge: true });

            const batch = db.batch();
            imported.reservations.forEach(res => {
              const docRef = db.collection("locations").doc("rocher1H").collection("reservations").doc(String(res.id));
              batch.set(docRef, res);
            });
            
            batch.commit().then(() => {
              alert(`SUCCÈS : Migration terminée !`);
              this.saveAll();
            }).catch(err => alert("Erreur d'écriture : " + err.message));
          }
        } catch (err) { alert("Erreur de lecture : " + err.message); }
      };
      reader.readAsText(file);
    },

    triggerFileInput() { 
      document.getElementById('importFileInput').click(); 
    },

    switchTab(tabName) {
      this.tab = tabName;
      this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
    },

    changeGlobalYear(delta) {
      this.currentYear += delta;
      this.onYearChange();
    },

    onYearChange() {
      this.renderCalendar();
      this.syncCustomReservationLines();
      this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
    },

    openModalClientsList() {
      this.showModalClientsList = true;
      this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
    },
    
    isPerso(res) {
      if (!res) return false;
      const fullName = (res.nom + ' ' + (res.prenom || '')).toLowerCase().trim();
      const reverseName = ((res.prenom || '') + ' ' + res.nom).toLowerCase().trim();
      return fullName === 'indispo perso' || reverseName === 'indispo perso';
    },

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

    get knownClients() {
      const clients = [];
      const seen = new Set();
      const sorted = [...this.reservations].sort((a, b) => b.id - a.id);
      
      sorted.forEach(r => {
        if (!r.nom) return;
        const key = (r.nom + (r.prenom || '')).toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          clients.push(r);
        }
      });
      
      clients.sort((a, b) => a.nom.localeCompare(b.nom));

      const indispoIdx = clients.findIndex(c => {
         const fullName = (c.nom + ' ' + (c.prenom || '')).toLowerCase().trim();
         const reverseName = ((c.prenom || '') + ' ' + c.nom).toLowerCase().trim();
         return fullName === 'indispo perso' || reverseName === 'indispo perso';
      });
      
      if (indispoIdx > -1) {
         const indispoClient = clients.splice(indispoIdx, 1)[0];
         clients.unshift(indispoClient);
      }
      
      return clients;
    },

    get allClientsStats() {
      const stats = new Map();
      
      this.reservations.forEach(r => {
        if (this.isPerso(r) || !r.nom) return; 
        
        const key = (r.nom.trim() + '_' + (r.prenom || '').trim()).toLowerCase();
        
        if (!stats.has(key)) {
          stats.set(key, {
            cle: key,
            nomPrenom: r.nom.toUpperCase() + ' ' + (r.prenom || ''),
            telephone: r.telephone || '',
            email: r.email || '',
            adresseComplete: `${r.adresse || ''} ${r.codePostal || ''} ${r.ville || ''} ${r.pays || ''}`.trim() || 'N/C',
            nbSejours: 1
          });
        } else {
          const client = stats.get(key);
          client.nbSejours += 1;
          if (!client.telephone && r.telephone) client.telephone = r.telephone;
          if (!client.email && r.email) client.email = r.email;
          if (client.adresseComplete === 'N/C' && (r.adresse || r.ville)) {
              client.adresseComplete = `${r.adresse || ''} ${r.codePostal || ''} ${r.ville || ''} ${r.pays || ''}`.trim();
          }
        }
      });
      
      return Array.from(stats.values()).sort((a, b) => a.nomPrenom.localeCompare(b.nomPrenom));
    },

    exportClientsCSV() {
      const clients = this.allClientsStats;
      let csvContent = "\uFEFFNom et Prénom;Téléphone;Email;Adresse Postale;Nombre de Séjours\n";
      
      clients.forEach(c => {
        const nom = `"${c.nomPrenom.replace(/"/g, '""')}"`;
        const tel = `"${c.telephone.replace(/"/g, '""')}"`;
        const email = `"${c.email.replace(/"/g, '""')}"`;
        const adresse = `"${c.adresseComplete.replace(/"/g, '""')}"`;
        const sejours = c.nbSejours;
        
        csvContent += `${nom};${tel};${email};${adresse};${sejours}\n`;
      });
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const dl = document.createElement('a');
      dl.setAttribute('href', url);
      dl.setAttribute('download', `Base_Clients_Rocher_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
    },

    loadClientIntoForm(clientId) {
      if (!clientId) return;
      
      const refRes = this.reservations.find(r => String(r.id) === String(clientId));
      if (!refRes) return;

      const nom = (refRes.nom || '').toLowerCase().trim();
      const prenom = (refRes.prenom || '').toLowerCase().trim();
      
      const pastStays = this.reservations.filter(r => 
        (r.nom || '').toLowerCase().trim() === nom && 
        (r.prenom || '').toLowerCase().trim() === prenom
      );

      pastStays.sort((a, b) => (b.dateDebut || '').localeCompare(a.dateDebut || ''));
      const c = pastStays[0];

      if (c) {
        this.form.nom = c.nom || ''; 
        this.form.prenom = c.prenom || '';
        this.form.telephone = c.telephone || ''; 
        this.form.email = c.email || '';
        this.form.adresse = c.adresse || ''; 
        this.form.codePostal = c.codePostal || '';
        this.form.ville = c.ville || ''; 
        this.form.pays = c.pays || 'France';
        
        if (c.origine) this.form.origine = c.origine;
        if (c.nbAdulte !== undefined) this.form.nbAdulte = Number(c.nbAdulte);
        if (c.nbEnfant !== undefined) this.form.nbEnfant = Number(c.nbEnfant);
        if (c.kitBebe) this.form.kitBebe = c.kitBebe;
      }
    },

    loadClientIntoEditForm(clientId) {
      if (!clientId) return;
      
      const refRes = this.reservations.find(r => String(r.id) === String(clientId));
      if (!refRes) return;

      const nom = (refRes.nom || '').toLowerCase().trim();
      const prenom = (refRes.prenom || '').toLowerCase().trim();
      
      const pastStays = this.reservations.filter(r => 
        (r.nom || '').toLowerCase().trim() === nom && 
        (r.prenom || '').toLowerCase().trim() === prenom
      );

      pastStays.sort((a, b) => (b.dateDebut || '').localeCompare(a.dateDebut || ''));
      const c = pastStays[0];

      if (c) {
        this.editForm.nom = c.nom || ''; 
        this.editForm.prenom = c.prenom || '';
        this.editForm.telephone = c.telephone || ''; 
        this.editForm.email = c.email || '';
        this.editForm.adresse = c.adresse || ''; 
        this.editForm.codePostal = c.codePostal || '';
        this.editForm.ville = c.ville || ''; 
        this.editForm.pays = c.pays || 'France';
        
        if (c.origine) this.editForm.origine = c.origine;
        if (c.nbAdulte !== undefined) this.editForm.nbAdulte = Number(c.nbAdulte);
        if (c.nbEnfant !== undefined) this.editForm.nbEnfant = Number(c.nbEnfant);
        if (c.kitBebe) this.editForm.kitBebe = c.kitBebe;
      }
    },

    roundToMultiple(val, step = 10) { return Math.round(val / step) * step; },
    calculateBookingPrice(publicPrice) {
      if (!publicPrice) return 0;
      const pct = Number(this.donnees.pctBooking) || 0;
      const menage = Number(this.donnees.prixMenage) || 0;
      return this.roundToMultiple(publicPrice * (1 + (pct / 100)) + menage, 10);
    },

    recalcRowBooking(row) {
      row.booking = this.calculateBookingPrice(Number(row.public) || 0);
      row.correction = row.booking;
      this.onTarifChange();
    },

    updateAllBookingTarifs() {
      Object.keys(this.gridTarifs).forEach(k => {
        const row = this.gridTarifs[k];
        row.booking = this.calculateBookingPrice(Number(row.public) || 0);
        if (!row.correction) row.correction = row.booking;
      });
      this.onTarifChange();
    },

    onTarifChange() { this.saveAll(); this.recalculateAllReservations(); },

    getReservationStatus(res) {
      if (!res) return 'option';
      if (this.isPerso(res)) return 'confirme';
      if (res.codeTarif === 'booking' || res.origine === 'booking') return 'confirme';
      return ((Number(res.acompte) || 0) > 0 || (Number(res.soldePaye) || 0) > 0) ? 'confirme' : 'option';
    },

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

    saveComptaData() { this.saveAll(); },

    get comptaMetrics() {
      const yr = String(this.currentYear);
      const yearRes = this.reservations.filter(r => r.dateDebut && r.dateDebut.startsWith(yr));
      
      const totalGainBrut = yearRes.reduce((sum, r) => sum + this.calcTotalSejour(r), 0);
      
      const totalOfficiel = yearRes.filter(r => {
        const tarif = String(r.codeTarif).toLowerCase().trim();
        return tarif !== 'black' && tarif !== 'perso';
      }).reduce((sum, r) => sum + this.calcTotalSejour(r), 0);
      
      const taxeCalculer = yearRes.reduce((sum, r) => sum + this.calcTaxeSejour(r), 0);
      const nbNuitsTotal = yearRes.reduce((sum, r) => sum + this.calcNights(r.dateDebut, r.dateFin), 0);
      
      const nbNuitsOfficiel = yearRes.filter(r => 
        String(r.origine).toLowerCase().trim() === 'booking' || 
        String(r.codeTarif).toLowerCase().trim() === 'booking' || 
        this.calcTaxeSejour(r) > 0
      ).reduce((sum, r) => sum + this.calcNights(r.dateDebut, r.dateFin), 0);
      
      const nbSemaines = Math.round((nbNuitsTotal / 7) * 100) / 100;
      const tauxOccupation = Math.round((nbNuitsTotal / 365) * 1000) / 10;
      const paiementsRecus = yearRes.reduce((sum, r) => sum + (Number(r.acompte) || 0) + (Number(r.soldePaye) || 0), 0);
      const paiementsARecevoir = yearRes.reduce((sum, r) => sum + this.calcResteAPayer(r), 0);
      const menageEnPlus = Number(this.getComptaYearData(yr).menageEnPlus) || 0;
      const nbMenages = yearRes.filter(r => String(r.forceMenageNon).toLowerCase().trim() !== 'oui').length;
      
      const nbRemiseCles = yearRes.filter(r => String(r.codeTarif).toLowerCase().trim() !== 'perso' && String(r.origine).toLowerCase().trim() !== 'perso').length;
      
      const coutTotalConciergerie = ((nbMenages + menageEnPlus) * (Number(this.donnees.prixReelMenage) || 60)) + (nbRemiseCles * (Number(this.donnees.prixRemiseCle) || 60));
      const nbSejours = yearRes.length;
      const totalPersonnes = yearRes.reduce((sum, r) => sum + (Number(r.nbAdulte) || 0) + (Number(r.nbEnfant) || 0), 0);
      
      const nbBooking = yearRes.filter(r => String(r.origine).toLowerCase().trim() === 'booking').length;
      const nbValloire = yearRes.filter(r => {
         const origine = String(r.origine).toLowerCase().trim();
         return origine === 'valloire résa' || origine === 'valloire reservation';
      }).length;
      const nbRetour = yearRes.filter(r => String(r.origine).toLowerCase().trim() === 'retour').length;
      
      const nbPerso = yearRes.filter(r => String(r.codeTarif).toLowerCase().trim() === 'perso' || String(r.origine).toLowerCase().trim() === 'perso').length;
      
      return { 
        totalGainBrut, 
        totalOfficiel, 
        taxeCalculer, 
        nbNuitsTotal, 
        nbNuitsOfficiel, 
        nbSemaines, 
        tauxOccupation, 
        paiementsRecus, 
        paiementsARecevoir, 
        nbMenages, 
        menageEnPlus, 
        totalMenagesConciergerie: nbMenages + menageEnPlus, 
        nbRemiseCles, 
        nbPerso: nbPerso,
        coutTotalConciergerie, 
        nbSejours, 
        nbMoyenPersonnes: nbSejours > 0 ? (totalPersonnes / nbSejours).toFixed(2) : 0,
        nbOrigineBooking: nbBooking,
        nbOrigineValloire: nbValloire,
        nbOrigineRetour: nbRetour,
        nbOriginePerso: nbPerso,
        pctOrigineBooking: nbSejours > 0 ? Math.round((nbBooking / nbSejours) * 100) : 0,
        pctOrigineValloire: nbSejours > 0 ? Math.round((nbValloire / nbSejours) * 100) : 0,
        pctOrigineRetour: nbSejours > 0 ? Math.round((nbRetour / nbSejours) * 100) : 0,
        pctOriginePerso: nbSejours > 0 ? Math.round((nbPerso / nbSejours) * 100) : 0
      };
    },

    get comptaTotalRambaud() { const d = this.getComptaYearData(this.currentYear); return (Number(d.rambaudT1)||0) + (Number(d.rambaudT2)||0) + (Number(d.rambaudT3)||0) + (Number(d.rambaudT4)||0) + (Number(d.rambaudReliquat)||0); },
    get comptaTotalSorea() { const d = this.getComptaYearData(this.currentYear); return (Number(d.sorea1)||0) + (Number(d.sorea2)||0) + (Number(d.sorea3)||0) + (Number(d.sorea4)||0) + (Number(d.sorea5)||0); },
    get comptaTotalTaxesDirectes() { const d = this.getComptaYearData(this.currentYear); return (Number(d.taxeFonciere)||0) + (Number(d.taxeHabitation)||0); },
    get comptaTotalAutres() { const d = this.getComptaYearData(this.currentYear); return (Number(d.autreMontant1)||0) + (Number(d.autreMontant2)||0) + (Number(d.autreMontant3)||0); },

    get comptaCalculImpots() {
      const d = this.getComptaYearData(this.currentYear);
      const imposable = Math.max(0, this.comptaMetrics.totalOfficiel - this.comptaMetrics.taxeCalculer) * ((Number(d.impotAbattementPct) || 0) / 100);
      const ir = imposable * ((Number(d.impotTauxIRPct) || 0) / 100);
      const csg = imposable * ((Number(d.impotTauxCSGPct) || 0) / 100);
      return { montantImposable: imposable, montantIR: ir, montantCSG: csg, totalImpots: ir + csg };
    },

    get comptaTotalGeneralCharges() {
      const d = this.getComptaYearData(this.currentYear);
      return this.comptaMetrics.taxeCalculer + this.comptaMetrics.coutTotalConciergerie + (Number(d.assuranceAppart)||0) + (Number(d.assuranceCredit)||0) + this.comptaTotalRambaud + this.comptaTotalSorea + this.comptaTotalTaxesDirectes + (Number(d.forfait)||0) + (Number(d.centralResa)||0) + (Number(d.internet)||0) + this.comptaTotalAutres + this.comptaCalculImpots.totalImpots;
    },

    get comptaTaxeRestante() {
      const yearObj = this.getComptaYearData(this.currentYear);
      return Math.max(0, this.comptaMetrics.taxeCalculer - (Number(yearObj.taxePayee)||0) - (Number(yearObj.taxeARetirer)||0));
    },

    get comptaRestantTotal() { return this.comptaMetrics.totalGainBrut - this.comptaTotalGeneralCharges; },
    get comptaPourcentageRatio() { return this.comptaTotalGeneralCharges === 0 ? 0 : (this.comptaMetrics.totalGainBrut / this.comptaTotalGeneralCharges) * 100; },
    get comptaCreditAnnuel() { return 5551.20; },
    get comptaCreditReste() { return this.comptaCreditAnnuel - this.comptaRestantTotal; },
    get comptaCreditFinancePourcentage() { return 100 - ((this.comptaCreditReste / this.comptaCreditAnnuel) * 100); },
    get comptaCreditRestePersMois() { return this.comptaCreditReste / 24; },

    isDateClosed(dateStr) {
      if (!this.donnees.fermetures) return false;
      return this.donnees.fermetures.some(f => f.debut && f.fin && dateStr >= f.debut && dateStr <= f.fin);
    },

    clearFermeture(index) {
      this.donnees.fermetures[index] = { debut: '', fin: '' };
      this.saveAll();
      this.renderCalendar();
    },

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
        return (this.isPerso(res) ? 'Perso : ' : (this.getReservationStatus(res) === 'confirme' ? 'Confirmé : ' : 'Option : ')) + res.nom + ' ' + (res.prenom || '');
      }
      
      let tMatin = day.resMatin ? (this.isPerso(day.resMatin) ? 'Perso' : day.resMatin.nom) : 'Libre';
      let tAprem = day.resAprem ? (this.isPerso(day.resAprem) ? 'Perso' : day.resAprem.nom) : 'Libre';
      return `Matin (Départ) : ${tMatin} \nAprem (Arrivée) : ${tAprem}`;
    },

    renderCalendar() {
      const months = [];
      for (let m = 0; m < 12; m++) {
        const date = new Date(this.currentYear, m, 1);
        let firstDayIndex = date.getDay() - 1;
        if (firstDayIndex === -1) firstDayIndex = 6;
        const daysArr = [];
        for (let d = 1; d <= new Date(this.currentYear, m + 1, 0).getDate(); d++) {
          const currentDayStr = `${this.currentYear}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          
          const resMatin = this.reservations.find(r => currentDayStr > r.dateDebut && currentDayStr <= r.dateFin);
          const resAprem = this.reservations.find(r => currentDayStr >= r.dateDebut && currentDayStr < r.dateFin);
          
          const isClosed = this.isDateClosed(currentDayStr);
          
          daysArr.push({ dayNum: d, dateStr: currentDayStr, resMatin: resMatin || null, resAprem: resAprem || null, isClosed: isClosed });
        }
        months.push({ name: date.toLocaleString('fr-FR', { month: 'long' }), padding: firstDayIndex, days: daysArr });
      }
      this.calendarMonths = months;

      let d = new Date(this.currentYear, 0, 1);
      while (d.getDay() !== 6) { d.setDate(d.getDate() + 1); }
      let wNum = 1;
      while (d.getFullYear() <= this.currentYear && wNum <= 52) {
        const start = new Date(d); const end = new Date(d); end.setDate(end.getDate() + 7);
        const key = `STD-${this.currentYear}-W${String(wNum).padStart(2, '0')}`;
        const startISO = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        if (!this.gridTarifs[key]) {
          const bookingVal = this.calculateBookingPrice(400);
          this.gridTarifs[key] = { key, label: 'Semaine ' + wNum, isCustom: false, public: 400, booking: bookingVal, correction: bookingVal, libre: 0, startISO, endISO };
        } else {
          this.gridTarifs[key].startISO = startISO; this.gridTarifs[key].endISO = endISO;
          if (this.gridTarifs[key].correction === undefined) this.gridTarifs[key].correction = this.gridTarifs[key].booking;
        }
        d.setDate(d.getDate() + 7); wNum++;
      }
    },

    deleteGridRow(key) {
      if (confirm('Effacer cette ligne de tarif sur-mesure ?')) {
        delete this.gridTarifs[key]; this.saveAll(); this.recalculateAllReservations(); this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },

    get filteredGridTarifs() { return Object.values(this.gridTarifs).filter(r => r.startISO && r.startISO.startsWith(String(this.currentYear))).sort((a, b) => a.startISO.localeCompare(b.startISO)); },
    get filteredReservationsByYear() { return this.reservations.filter(r => r.dateDebut && r.dateDebut.startsWith(String(this.currentYear))).sort((a, b) => a.dateDebut.localeCompare(b.dateDebut)); },
    get selectedDocRes() { return this.selectedDocResId ? this.reservations.find(r => r.id === this.selectedDocResId) || null : null; },

    getTarifRowForStay(dateDebut, dateFin) {
      const customKey = `CUST-${dateDebut}_${dateFin}`;
      if (this.gridTarifs[customKey]) return this.gridTarifs[customKey];
      const rows = Object.values(this.gridTarifs);
      for (let r of rows) if (r.startISO === dateDebut && r.endISO === dateFin) return r;
      for (let r of rows) if (dateDebut >= r.startISO && dateDebut < r.endISO) return r;
      return { public: 400, booking: 550, correction: 550, libre: 0 };
    },

    getReservationForTarif(w) {
      if (w.isCustom) return null;
      return this.reservations.find(r => r.dateDebut && r.dateFin && w.startISO >= r.dateDebut && w.endISO <= r.dateFin);
    },

    calculateStayPrice(dateDebut, dateFin, codeTarif) {
      if (!dateDebut || !dateFin) return 0;
      const row = this.getTarifRowForStay(dateDebut, dateFin);
      if (codeTarif === 'booking') return Number(row.correction) || Number(row.booking) || 0;
      if (['libre', 'perso', 'black'].includes(codeTarif)) return Number(row.libre) || 0;
      return Number(row.public) || 0;
    },

    calcMenage(res) { return (!res || res.forceMenageNon === 'oui' || res.codeTarif === 'perso') ? 0 : (['public', 'libre', 'black'].includes(res.codeTarif || 'public') ? (Number(this.donnees.prixMenage) || 0) : 0); },
    calcTaxeSejour(res) { return (!res || ['perso', 'black', 'booking'].includes(res.codeTarif || 'public')) ? 0 : (this.calcNights(res.dateDebut, res.dateFin) * (Number(res.nbAdulte) || 0) * (Number(this.donnees.taxeSejour) || 0)); },
    calcTotalSejour(res) { return !res ? 0 : (Number(res.prixTotal) || 0) + this.calcMenage(res) + this.calcTaxeSejour(res); },
    
    calcAcompte(res) {
      if (!res) return 0;
      const pct = (Number(this.donnees.pctAcompte) || 30) / 100;
      return Math.ceil((Number(res.prixTotal) || 0) * pct);
    },
    
    calcResteAPayer(res) { return !res ? 0 : Math.max(0, this.calcTotalSejour(res) - (Number(res.acompte) || 0) - (Number(res.soldePaye) || 0)); },

    updateReservationTarif(res) { res.prixTotal = this.calculateStayPrice(res.dateDebut, res.dateFin, res.codeTarif); this.saveAll(); },
    recalculateAllReservations() { this.reservations.forEach(r => { if (!r.codeTarif) r.codeTarif = 'public'; r.prixTotal = this.calculateStayPrice(r.dateDebut, r.dateFin, r.codeTarif); }); },

    openModalNewRes() { this.form = { nom: '', prenom: '', origine: 'booking', kitBebe: 'non', dateDebut: '', dateFin: '', nbAdulte: 1, nbEnfant: 0, telephone: '', email: '', adresse: '', codePostal: '', ville: '', pays: 'France' }; this.showModalNew = true; },
    openModalEditRes(res) { this.editForm = { ...res }; this.showModalEdit = true; this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); }); },

    onStartDateChange() { if (this.form.dateFin && this.form.dateFin < this.form.dateDebut) this.form.dateFin = this.form.dateDebut; },

    submitReservation() {
      if (this.form.dateFin <= this.form.dateDebut) return alert('La date de départ doit être après l\'arrivée.');
      
      const newRes = { id: Date.now(), codeTarif: 'public', acompte: 0, soldePaye: 0, dateVirementAcompte: '', numVirementAcompte: '', dateVirementSolde: '', numVirementSolde: '', cautionRecue: 'non', cautionRendue: 'non', forceMenageNon: 'non', ...this.form };
      newRes.prixTotal = this.calculateStayPrice(newRes.dateDebut, newRes.dateFin, newRes.codeTarif);
      
      this.reservations.push(newRes);
      this.saveLocalBackup();

      db.collection("locations").doc("rocher1H").collection("reservations").doc(String(newRes.id)).set(newRes);
      
      this.syncCustomReservationLines();
      this.saveAll(); 
      this.renderCalendar();
      this.showModalNew = false; 
    },

    submitEditReservation() {
      if (this.editForm.dateFin <= this.editForm.dateDebut) return alert('La date de départ doit être après l\'arrivée.');
      
      this.editForm.prixTotal = this.calculateStayPrice(this.editForm.dateDebut, this.editForm.dateFin, this.editForm.codeTarif);
      
      const idx = this.reservations.findIndex(r => r.id === this.editForm.id);
      if (idx !== -1) this.reservations[idx] = { ...this.editForm };
      this.saveLocalBackup();

      db.collection("locations").doc("rocher1H").collection("reservations").doc(String(this.editForm.id)).set(this.editForm);
      
      this.syncCustomReservationLines();
      this.saveAll(); 
      this.renderCalendar();
      this.showModalEdit = false; 
    },

    deleteReservation(id) {
      if (confirm('Voulez-vous vraiment supprimer cette réservation ?')) {
        this.reservations = this.reservations.filter(r => r.id !== id);
        this.saveLocalBackup();

        db.collection("locations").doc("rocher1H").collection("reservations").doc(String(id)).delete();
        
        if (this.selectedDocResId === id) this.selectedDocResId = null;
        
        this.syncCustomReservationLines();
        this.saveAll(); 
      }
    },

    openClientCard(res) { this.selectedRes = res; this.showModalClient = true; this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); }); },

    calcNights(start, end) { return (!start || !end) ? 0 : Math.max(0, Math.round((new Date(end.split('-')[0], end.split('-')[1] - 1, end.split('-')[2]) - new Date(start.split('-')[0], start.split('-')[1] - 1, start.split('-')[2])) / (1000 * 60 * 60 * 24))); },
    formatDate(dStr) { return !dStr ? '' : `${dStr.split('-')[2]}/${dStr.split('-')[1]}/${dStr.split('-')[0]}`; },
    formatCurrency(val) { return (Number(val) || 0).toFixed(2) + ' €'; }
  }
}