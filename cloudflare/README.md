# Archivio ordini Pescheria Massimo

## Risorse

- Sito clienti: https://ermestre.github.io/pescheriamassimo/
- Worker e pannello: https://pescheria-massimo-api.ermestrerm.workers.dev/
- D1: `pescheriamassimo`, binding **`db`** (minuscolo).
- Segreto di produzione: `ADMIN_TOKEN`, almeno 20 caratteri casuali. Non inserirlo nel repository, nel sito clienti, negli URL o nei log.

## Pubblicazione

1. Copiare tutto `cloudflare/worker.js` nell'editor del Worker e premere Distribuisci.
2. Conservare binding e segreto già presenti. Il Worker usa la tabella `orders` già creata. La tabella tecnica `order_limits` è creata automaticamente al primo invio.
3. GitHub Pages pubblica `index.html` tramite il flusso già configurato.
4. Aprire il sito clienti aggiornato, scegliere prodotto, nome, cellulare e ritiro. Premere Ordina e ritira, controllare, poi Invia ordine.
5. Aprire il pannello amministratore, accedere e selezionare la stessa data di ritiro. Premere Aggiorna. Verificare codice, quantità, pagamento e stato anche da un altro dispositivo.

La pubblicazione su GitHub non aggiorna automaticamente questo Worker creato manualmente: il passaggio 1 va ripetuto quando cambia worker.js.

## Funzionamento

- Il server legge il menu dal ramo `main`, ricalcola i prezzi e salva nomi, quantità, unità, prezzi e totale in centesimi. I vecchi ordini non cambiano quando si modifica il menu.
- Ogni invio usa un UUID. I tentativi ripetuti con lo stesso codice e contenuto restituiscono l'ordine già ricevuto. Contenuti diversi con lo stesso codice sono rifiutati. Il browser conserva in sessione una firma e il codice dell'ultimo tentativo, senza salvare lì il testo dei dati personali.
- Il pulsante Nuovo ordine azzera carrello e codice, permettendo anche un secondo ordine identico intenzionale.
- L'ordine salvato parte da Nuovo. La ricevuta non significa conferma della pescheria e non invia notifiche al cliente. WhatsApp resta facoltativo e non viene letto dal sistema. Gli ordini inviati solo via WhatsApp non vengono archiviati automaticamente.
- Il pannello controlla da solo ogni 30 secondi (vedi "Consumo D1" in fondo), si apre sugli ordini nuovi, confermati e pronti di tutte le date, ordinati per ritiro. Include anche ordini rimasti aperti con data passata. Il filtro per giorno è facoltativo; Tutti include anche ritirati e annullati. Mostra fino a 500 ordini per vista, e se sono di più chiede una data senza mostrare un elenco incompleto. I totali si riferiscono alla vista selezionata. La chiave resta in memoria, salvo la scelta Ricordami descritta più avanti. La scheda Pagato indica una registrazione manuale, non un pagamento online.
- Giorni: oggi e i prossimi 13 giorni, lunedì escluso, fuso Europe/Rome; le chiusure possono essere date ISO nel menu. Orari standard definiti in HOURS; per prodotti su ordinazione si applicano gli orari serali del menu. Finestre personalizzate non vuote bloccano l'invio fino a una loro implementazione esplicita.
- Termini ordini supportati: `HH:MM del giorno prima` e `HH:MM del giorno stesso`. Il termine del prodotto prevale sulla categoria e poi sul termine generale. Termini in altri formati bloccano l'invio e richiedono un aggiornamento. Gli orari già trascorsi vengono rifiutati dal server.
- Il server rifiuta prodotti esauriti, non disponibili, fuori periodo, quantità non valide e totali diversi da quelli mostrati al cliente. In caso di modifica del prezzo il cliente deve aggiornare il menu e controllare nuovamente il riepilogo.

## Protezioni e limiti

Le API di lettura/modifica richiedono la chiave sul server. I dati dei clienti non sono scritti su GitHub. L'API pubblica usa query parametrizzate, corpo massimo 20 KB, controllo origine, campo esca e limiti atomici D1: 10 tentativi per indirizzo e 100 complessivi per finestra fissa di 10 minuti. Gli indirizzi non sono salvati in chiaro: i contatori usano una firma con segreto e finestra temporale, eliminata dopo la finestra successiva. Una rete condivisa può incontrare il limite per indirizzo. CORS non sostituisce l'autenticazione e questi limiti non eliminano tutto lo spam; prima di una diffusione ampia valutare Turnstile e protezioni Cloudflare dedicate.

Non sono ancora implementati notifiche push/WhatsApp, pagamenti, capacità massima per fascia, autenticazione di ogni cliente, cancellazione automatica o esportazione archivio. Per uso reale vanno definiti informativa e tempi di conservazione, prezzi effettivi e regole di ritiro con il titolare. Il menu attuale segnala prezzi di esempio.

## Verifica locale

Node.js 24:

```sh
node tests/orders.test.cjs
node tests/worker.test.mjs
```

Il secondo test esegue il vero handler con SQLite in memoria: invio, retry dopo risposta persa, conflitti, prezzi storici, validazione, autenticazione, CORS e limiti. La rete menu è simulata; nessun ordine reale viene creato dai test. La verifica finale sui servizi pubblicati richiede la prova del punto 4.

Documentazione consultata il 1 novembre 2026: [D1](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [CORS](https://developers.cloudflare.com/workers/examples/cors-header-proxy/), [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Menu e preparazioni (1 novembre 2026)

Spigola, Orata, Rombo e Sogliola hanno ID distinti. Prezzi ereditati dalle precedenti voci aggregate solo come esempi, da verificare; nessun nuovo dato di provenienza è stato dedotto. Le foto condivise sono segnalate come indicative. Gli ordini precedenti conservano le loro descrizioni e gli importi salvati.

In gestione.html, Preparazioni disponibili abilita Intero, Pulito e A filetti per ciascun prodotto. Sono servizi da confermare con il titolare; inizialmente le quattro specie separate hanno soltanto Intero. Non è implementato un supplemento economico per la lavorazione. Il peso finale va verificato al banco. La scelta appare nel riepilogo e, con il nuovo Worker distribuito, nell'articolo salvato e nel pannello ordini. Il server rifiuta scelte non presenti nel menu e distingue i tentativi con preparazioni diverse.

Il sito legge preparations_supported da /api/config. Finché è attivo il Worker precedente, conserva la preparazione nelle note dell'ordine; dopo l'aggiornamento la salva nel campo strutturato preparation. L'aggiornamento del Worker va eseguito manualmente come indicato sopra; nessuna migrazione D1 richiesta.

Provenienza, metodo, zona FAO, attrezzo, stato fresco/decongelato/congelato e consiglio sono compilabili dal gestore. I campi vuoti non producono dichiarazioni al cliente. La voce In evidenza non dichiara più Arrivato oggi in assenza di una data verificata. L'avviso generale menu.nota è visibile e modificabile nella gestione.

Il QR statico img/qr-menu.svg apre https://ermestre.github.io/pescheriamassimo/ e si trova nella pagina di gestione. È un QR del menu, non un codice lotto o una certificazione.

Verifiche aggiuntive: node tests/menu.test.cjs. Le verifiche automatiche non sostituiscono una prova visiva e di invio sui servizi pubblicati.

## Schede prodotto e archivio arrivi

La foto è un pulsante accessibile; Scheda e provenienza apre la stessa scheda con quantità, preparazione, prezzo, lotto del fornitore, specie, paese, zona FAO, metodo, attrezzo, arrivo, data pesca documentata, stato del prodotto e consiglio multilinea. I campi vuoti restano nascosti. Confermare una quantità scelta nella scheda non la aggiunge una seconda volta.

Tutti i prodotti esistenti della categoria pesce fresco hanno una preparazione configurata, coerente con il nome attuale: Intero per gamberi/bianchetti, Già sgusciato per gamberetti già sgusciati, A tranci per tonno/spada. Pulizia, sfilettatura e altri servizi rimangono configurabili per prodotto dal gestore; i prodotti già pronti non ricevono lavorazioni arbitrarie. La disponibilità del pesce spada resta invariata.

Nella gestione, lotto_fornitore è il codice originale; paese_origine e data_pesca sono facoltativi. Non ci sono interrogazioni automatiche a registri o certificazioni. Il lotto corrente viene copiato nelle note dei nuovi ordini e nel testo WhatsApp, mantenendo lo storico dell'ordine quando il menu cambia. Nessun aggiornamento del Worker richiesto per queste note.

Al salvataggio, registraArrivi conserva in archivio_arrivi una fotografia dei soli campi pubblici di provenienza del prodotto quando esiste un lotto. Salvataggi identici non duplicano le copie; un lotto nuovo o una correzione genera una nuova copia. L'archivio è conservato nel menu.json pubblico su GitHub, consultabile in gestione come sola lettura: non inserire fatture o dati personali. Non è un registro privato né sostituisce la documentazione del fornitore. Un prodotto con lotto/storico può essere nascosto con Terminato e non viene eliminato dalla UI.

Questa versione gestisce un lotto corrente per voce di menu. Per esporre contemporaneamente partite differenti della stessa specie occorrono voci distinte; non viene dedotto il lotto effettivamente consegnato al banco. I dati inseriti nell'ordine descrivono il lotto mostrato al momento della prenotazione.


## Resoconto e registro incassi (1 novembre 2026)

Il Worker include anche conferma WhatsApp e avvisi per nuovi ordini. Per attivare tutto, sostituire l'intero cloudflare/worker.js nell'editor Cloudflare e distribuire. Nessuna modifica al menu clienti o SQL manuale: la tabella payment_events viene creata con CREATE TABLE IF NOT EXISTS alla prima chiamata amministrativa autenticata. Gli ordini esistenti restano intatti.

- Registra incasso salva importo effettivo in centesimi, contanti/carta, data e ora server. Si registra il saldo completo, non acconti o pagamenti frazionati. L'importo effettivo può differire dalla stima del menu.
- Registra rimborso totale aggiunge un movimento negativo e riapre il saldo. Scegliere il metodo con cui il denaro viene effettivamente restituito. Non elimina il movimento originale. Annullare un ordine non restituisce denaro e non crea automaticamente rimborsi.
- I movimenti hanno un codice univoco e vengono salvati con batch atomico D1: le ripetizioni dello stesso movimento non duplicano gli incassi. I metodi di modifica del vecchio flag paid sono disabilitati a favore del registro.
- I pagamenti già segnati prima dell'aggiornamento rimangono pagati ma non hanno data, metodo o importo effettivo verificabili. Non sono inventati movimenti retroattivi; il rimborso dal registro è disponibile solo per incassi registrati con la nuova funzione.
- Resoconto giornaliero distingue ordini e prodotti per data di ritiro da incassi e rimborsi per giorno del movimento in Europe/Rome. Il totale ordini e il residuo sono stime del menu; gli incassi sono importi effettivamente registrati dall'operatore. I prodotti includono gli ordini non annullati, anche se non ancora ritirati: non sono una misura delle vendite completate.
- CSV dei movimenti include giorno/ora italiani, codici, cliente, tipo, metodo e importo. I valori negativi dei rimborsi restano numerici; i testi potenzialmente interpretati come formule sono neutralizzati. Il download contiene dati dei clienti e va conservato dal gestore.
- Il pannello è un registro interno degli ordini online, non uno strumento fiscale o una riconciliazione automatica bancaria. Il suono e il CSV vanno provati nel browser del gestore dopo la distribuzione.

Verifica locale: node tests/worker.test.mjs (SQLite reale in memoria, batch con rollback, retry, importi, rimborsi, date italiane, CSV e script HTML effettivamente servito), node tests/orders.test.cjs, node tests/menu.test.cjs. Nessun ordine o pagamento di produzione è stato creato dai test.


## MP3 per avvisi (1 novembre 2026)

Nel pannello, Suono personalizzato permette di caricare un MP3 fino a 5 MB. Il file viene decodificato prima dell'uso e salvato in IndexedDB del browser, senza caricarlo su Cloudflare o GitHub. Vengono riprodotti al massimo i primi 10 secondi. Su un altro dispositivo/browser occorre selezionarlo nuovamente; cancellando i dati del sito si perde la scelta. Se lo storage non è disponibile, il file resta attivo solo nella pagina corrente con avviso esplicito.

Attiva avvisi/Prova suono abilita l'audio dopo il gesto dell'utente e recupera il file salvato. Ripristina doppio bip elimina la scelta locale. Il suono di base è composto da due bip. Il caricamento di un file danneggiato non sostituisce il suono precedente. Il pannello deve restare aperto, con audio consentito e PC attivo.

Verifica: node tests/alerts.test.mjs esegue la logica del pannello servito dal Worker con AudioContext e IndexedDB simulati (doppio bip, MP3, limite, file corrotto, riapertura e ripristino). Non è un test acustico reale: verificare il file MP3 sul browser del gestore dopo la distribuzione del Worker completo.


## Ricordami su questo dispositivo (1 novembre 2026)

La spunta è disattivata per impostazione iniziale. Se selezionata, dopo un accesso riuscito salva la chiave amministrativa in localStorage di quel browser e ripristina automaticamente la sessione alla riapertura. È la chiave effettiva, non un token a scadenza: chi usa quel profilo browser può accedere agli ordini. Usare solo sul proprio dispositivo. Senza spunta, la chiave rimane solo in memoria.

Esci rimuove la chiave salvata e chiude la pagina autenticata. Una risposta 401 rimuove una chiave non più valida. In caso di storage bloccato compare un messaggio; l'accesso temporaneo rimane possibile. La scelta è separata per PC/browser, come il file MP3. L'audio richiede ancora Attiva avvisi dopo una nuova apertura. L'aggiornamento completo del Worker conserva tutte le funzioni precedenti.

Verifica: node tests/access.test.mjs esegue lo script HTML effettivamente servito in un ambiente DOM/storage simulato, coprendo consenso, riapertura, logout, sessione temporanea, chiave rifiutata e storage bloccato. Suite Worker e avvisi passate. Verificare sul browser reale dopo la distribuzione.


## Menu delle festività (1 novembre 2026)

La scheda di gestione Natale diventa Festività. L'ID interno natale rimane per conservare i dati esistenti. Si gestisce una ricorrenza per volta: Natale, Capodanno, Pasqua, Ferragosto o altra. Scegliere una ricorrenza cambia il titolo suggerito senza cancellare i piatti. La presentazione e il titolo sono modificabili. Nessun piatto, prezzo, ricorrenza o apertura viene inventato o pubblicato automaticamente.

Configurazione: selezionare ricorrenza, titolo e presentazione; impostare periodo di visibilità e giorno unico di ritiro; facoltativamente data/ora assoluta di chiusura delle prenotazioni; aggiungere i piatti con il pulsante dedicato. Un piatto nuovo parte non in vendita con prezzo 0: compilare nome, porzioni, prezzo e disponibilità. Pubblica il menu della festività abilita la sezione nelle sole date previste. Togliere la spunta permette di salvare bozze incomplete. Le eventuali sezioni già pubblicate con periodo sono preservate alla lettura. Il primo salvataggio applica il flag esplicito.

Il menu clienti mostra presentazione, ritiro e scadenza sopra i prodotti, con le normali quantità e informazioni del pesce. Scegliendo un piatto festivo viene selezionata la data speciale, quando disponibile nel servizio ordini. Gli orari restano quelli del menu ordinario, non ci sono limiti di capienza per fascia. Prenotazioni scadute restano visibili ma non ordinabili. Non vengono creati menu completi per 2/4/6 persone o proposte precompilate: aggiungerli come prodotti solo dopo accordo con Massimo.

Il Worker aggiunge la data di ritiro esplicitamente configurata anche oltre la finestra ordinaria di 14 giorni (e anche di lunedì, come apertura speciale esplicita). Le chiusure impostate in ritiro.chiusure restano prioritarie. In una data fuori dai giorni ordinari sono accettati solo piatti festivi; per i piatti festivi è richiesta esattamente la loro data. Il server verifica pubblicazione, periodo e scadenza in Europe/Rome. Se manca una scadenza assoluta rimangono i termini relativi ordinari. Gli ordini conservano nei prodotti l'occasione scelta, visibile nel pannello.

Distribuzione: menu e gestione si aggiornano con GitHub Pages. Sostituire e distribuire l'intero cloudflare/worker.js su Cloudflare prima di attivare le prenotazioni festive. Il client abilita i prodotti festivi solo quando il servizio dichiara festivities_supported:true; con Worker precedente mostra Prenotazioni della festività in preparazione. Non serve SQL aggiuntivo. Le altre funzioni del pannello sono incluse nel file completo.

Verifica: tests/festivities.test.mjs copre ritiro oltre 14 giorni, rifiuto data sbagliata e prodotti ordinari sulla data speciale, scadenza italiana al minuto, bozza, lunedì esplicito e chiusure; tests/menu.test.cjs copre editor, date, testi e bozze. Suite Worker, accesso e avvisi passate. Nessun ordine reale inserito dai test; verifica visiva nel browser ancora da fare.


## Disponibilità, prenotazioni e banco (2 novembre 2026)

Il pannello ordini ha Disponibilità e vendite al banco. Aggiorna disponibilità elenca i prodotti del menu. Senza carico il prodotto è senza limite; Aggiungi arrivo disponibile attiva la gestione e incrementa il residuo. Inserire solo quantità libere, al netto degli ordini già presenti. Scala vendita al banco decrementa la quantità libera: non va usato per consegnare un ordine online, già scalato al momento della prenotazione.

Quantità in millesimi (grammi per kg; pezzi/porzioni interi per altre unità), senza errori di virgola mobile nei saldi. Carichi e vendite usano UUID idempotenti e un batch D1 atomico. I trigger prenotano insieme all'inserimento dell'ordine: se un solo prodotto non basta, l'intero ordine non viene inserito. Ritentare un ordine con lo stesso codice non scala due volte. Il server è autorevole anche se il cliente ha una pagina con disponibilità vecchie.

Annullato libera le prenotazioni; ripetere l'annullamento non aggiunge quantità. Riattivare un annullato richiede nuovamente disponibilità sufficiente. Ritirato mantiene la quantità scalata. Le prenotazioni degli ordini raccolti prima dell'attivazione della gestione per quel prodotto non vengono ricostruite né restituite con date/quantità inventate. Non cancellare direttamente ordini o prodotti con SQL.

Le quantità sono per prodotto e condivise tra tutti i giorni di ritiro, non per lotto o giornata. Il menu clienti mostra il residuo dell'ultima lettura della configurazione; il controllo definitivo avviene nell'invio. Gli ordini nuovi non ancora confermati impegnano subito la quantità. Gli importi effettivi dell'incasso non correggono automaticamente eventuali differenze di peso al banco. La schermata stock si aggiorna con il suo pulsante. Non è introdotta una scadenza automatica delle prenotazioni.

Distribuire l'intero Worker aggiornato: crea automaticamente inventory, stock_moves e stock_reservations e i trigger alla prima richiesta. Nessun SQL manuale. Il menu clienti si pubblica su GitHub Pages; prima del deploy Worker le quantità restano senza limite, come in precedenza. Non sono state assegnate quantità reali né modificati ordini/menu.json in produzione.

Verifica: node tests/stock.test.mjs con SQLite reale in memoria (carichi, banco e invii ripetuti, rifiuto senza ordini parziali, annullamento/riattivazione, ritirato, ordini storici e disponibilità pubblica); suite Worker, menu, accesso e avvisi passate. Nessuna verifica sul D1 di produzione: fare una prova dopo distribuzione con un prodotto test.

Riferimenti Cloudflare verificati il 2 novembre 2026: https://developers.cloudflare.com/d1/sql-api/sql-statements/ e https://developers.cloudflare.com/d1/worker-api/d1-database/ (SQL SQLite e batch atomici).


## Consumo D1 del pannello (2 novembre 2026)

Problema: ogni 30 secondi il pannello faceva due richieste; ognuna rieseguiva circa 11 istruzioni CREATE e leggeva l'intera tabella orders (senza indice), compresi ritirati e annullati. Con il piano gratuito (5 milioni di righe lette al giorno; dal 1 settembre 2026 al superamento le query falliscono fino a mezzanotte UTC) il consumo cresceva con l'archivio: circa 5.800 letture complete al giorno per ogni pannello aperto.

Soluzione:
- Tabelle, indici e trigger vengono creati una sola volta per database. La tabella app_meta conserva la versione dello schema (SCHEMA_VERSION): le richieste successive fanno solo una lettura di controllo. Aumentare SCHEMA_VERSION quando si aggiungono tabelle, indici o trigger.
- Indici orders_status_pickup e orders_pickup: ordini aperti e filtro per data non scorrono più tutto l'archivio.
- app_meta contiene anche un numero di revisione aggiornato da trigger a ogni nuovo ordine, cambio di stato o pagamento, incasso o rimborso. Ogni 30 secondi il pannello legge solo questo numero (GET /api/changes); ricarica gli ordini e fa suonare l'avviso solo quando cambia.
- L'aggiornamento automatico non svuota più la lista: la sostituisce in un solo passaggio, mantenendo la posizione sullo schermo e il messaggio in basso. Aggiorna e i filtri funzionano come prima.

Distribuzione: sostituire l'intero cloudflare/worker.js nell'editor Cloudflare e premere Distribuisci. La prima richiesta crea indici, tabella app_meta e trigger; nessun SQL manuale, nessun dato modificato. Il controllo del magazzino (/api/stock) resta su richiesta del pulsante.

Verifica: node tests/reads.test.mjs (SQLite reale in memoria con 600 ordini chiusi: nessuna istruzione CREATE dopo la prima richiesta, controllo da 2 letture, piano di esecuzione con indice, revisione aggiornata da stato, incasso e nuovo ordine). Le altre suite passano. Dopo la distribuzione controllare in Cloudflare, D1 → Metriche, le righe lette al giorno.

## Nuova grafica del pannello ordini (2 novembre 2026)

- Intestazione con l'insegna (img/insegna.jpg da GitHub Pages; la Content-Security-Policy consente solo immagini da https://ermestre.github.io). Se l'immagine non si carica resta il testo alternativo e la barra "Banco ordini" con la data di oggi.
- Ordini raggruppati per giorno di ritiro (Oggi, Domani, poi la data); i giorni passati con ordini ancora aperti sono in rosso con l'avviso "Ritiro già passato".
- Ogni ordine ha un cartellino con l'ora di ritiro, il colore dello stato sul bordo (Nuovo oro, Confermato blu, Pronto verde, Ritirato grigio, Annullato rosso), prodotti con quantità in evidenza, note evidenziate, numero del cliente toccabile per chiamare.
- Pulsante del passo successivo: Confermato → "Segna come pronto", Pronto → "Segna come ritirato". Usa lo stesso cambio di stato del menu Stato, che resta disponibile per ogni altra scelta (per esempio Annullato).
- Conteggi per stato in alto. Suono, disponibilità, resoconto ed Esci sono raccolti in fondo in "Altri strumenti".
- I messaggi compaiono in un riquadro in basso sullo schermo; toccandolo si chiude.

Nessuna modifica alle API, ai dati o alle funzioni di incasso, rimborso, conferma WhatsApp e avvisi. Verificato in Chromium (PC 1280 px e telefono 390 px) con ordini finti su database locale; suite di test passate tranne menu.test.cjs, che fallisce già su main per due controlli legati ai dati di menu.json.

## Eliminare gli ordini di prova (2 novembre 2026)

Nel pannello, sugli ordini con stato Annullato compare il pulsante "Elimina ordine" (visibile con Mostra → Tutti). Dopo una conferma elimina definitivamente l'ordine con i suoi incassi, rimborsi e prenotazioni di quantità. Gli ordini non annullati non si possono eliminare: il server risponde 409. Il trigger rev_order_delete aggiorna il numero di revisione (SCHEMA_VERSION 3), così gli altri pannelli aperti si aggiornano da soli. Verifica: node tests/elimina.test.mjs.

## Gestione guidata, carrello e orari configurabili (2 novembre 2026)

Gestione (gestione.html):
- Scheda del pesce a scelte: specie dal catalogo (riempie il nome scientifico e l'allergene), metodo di produzione (Pescato, Pescato in acque dolci, Allevato), zona di cattura FAO con sottozona o divisione per le zone 27 e 37, paese di allevamento, attrezzo di pesca (categorie dell'allegato III del Reg. UE 1379/2013), stato del prodotto e allergeni a pulsanti. Le date di arrivo, pesca e congelamento si scelgono dal calendario.
- Per ogni prodotto un riquadro indica cosa manca delle informazioni obbligatorie; dopo il salvataggio compare l'elenco dei prodotti in vendita da completare. Nessun dato di provenienza viene compilato in automatico.
- Scheda "Ritiro e ordini": termine generale, orari di ritiro standard e serali a pulsanti (ritiro.orari, ritiro.orari_sera), chiusure straordinarie e sospensione degli ordini.
- Per prodotto: termine proprio e ritiro serale (su ordinazione) con un tocco.
- Salvataggio in conflitto: messaggio chiaro con invito a Ricarica.

Menu clienti (index.html): pulsante Aggiungi, peso e preparazione solo dopo l'aggiunta, carrello modificabile nel foglio "Il tuo ordine", giorno e ora a pulsanti, nome e cellulare ricordati sul telefono solo se il cliente lo sceglie, conferma con codice corto (prime 6 cifre del codice ordine), scheda prodotto con prima le informazioni obbligatorie.

Worker: ritiro.orari dal menu (se valido, altrimenti gli orari predefiniti), codice corto accanto al nome nel pannello e nel messaggio di conferma WhatsApp. Distribuire il Worker prima di cambiare gli orari standard dalla gestione.

Verifica: tutte le suite passano; tests/ritiro.test.mjs controlla anche gli orari configurati. Prova in Chromium a 390 px: aggiunta prodotti, carrello, scelta giorno e ora, invio con conferma, gestione con scelte a pulsanti.

## Gestione del menu semplificata e orari di apertura (2 novembre 2026)

- Menu come elenco compatto: per ogni prodotto foto, nome, avvisi (Non in vendita, Esaurito, Da completare), prezzo modificabile, interruttore In vendita e pulsante Esaurito. Toccando il nome si apre un foglio con tutti i dettagli (foto, preparazioni e ritiro, scheda del pesce, consiglio); "Fatto" lo chiude.
- Ricerca per nome in cima all'elenco.
- Un solo modo per aggiungere: "+ Aggiungi" accanto a ogni categoria apre un foglio con ricerca nel catalogo delle specie (nome scientifico e allergene automatici) oppure nome libero, prezzo e unità a pulsanti. Il prodotto parte non in vendita e si apre subito la sua scheda.
- Orari di apertura del negozio (menu.orari_apertura, sette giorni con chiuso e due fasce) nella scheda Ritiro e ordini, con "copia su tutti i giorni aperti". Il menu clienti li mostra in fondo raggruppando i giorni uguali; senza orari resta "Chiuso il lunedì". Non modificano gli orari di ritiro.

Verifica: node tests/gestione.test.cjs; prova in Chromium a 390 px. Nessuna modifica al Worker.

## Preparazioni e prova completa (2 novembre 2026)

- Menu clienti: con una sola preparazione compare la scritta "Preparazione: ..." al posto del menu a tendina.
- Gestione: nella scheda del prodotto le preparazioni tipiche per tipo (pesce intero, pesce da tranci, crostacei, cefalopodi; nessuna per bivalvi, baccalà e prodotti pronti) con il pulsante "Attiva le suggerite". Non si attivano mai da sole.
- Pannello: dopo "Conferma su WhatsApp" la scheda diventa subito Confermato e compare "Segna come pronto".
- Prova completa in Chromium con worker.js e pagine reali in locale: ogni prodotto in vendita con ogni preparazione ordinato dal sito e ritrovato nel pannello con codice corto e preparazione; carrello misto con orari serali; dati ricordati; conferma WhatsApp, pronto, incasso, ritirato, resoconto, CSV, annulla ed elimina; prezzo ed Esaurito dalla gestione visti dal sito e accettati dal servizio; nuovo prodotto non in vendita invisibile. 69 controlli superati, nessun errore JavaScript.

## Quantità dalla gestione del menu (3 novembre 2026)

- Worker: POST /api/stock con kind "set" imposta la quantità assoluta in un'unica operazione (la differenza è calcolata nel database, senza perdere ordini arrivati nel frattempo); "unlimited" toglie il limite. Le richieste a /api/stock da https://ermestre.github.io ricevono le intestazioni CORS (preflight compreso); serve sempre la chiave ADMIN_TOKEN. Ordini, incassi e resoconti restano accessibili solo dal pannello.
- Gestione: nella scheda di ogni prodotto la sezione "Quantità disponibile" (Imposta, Togli il limite, disponibile e prenotato) e nella riga l'etichetta "N kg disponibili". La chiave del pannello si inserisce una volta e resta su quel telefono (pm_ordini_key); se non è valida viene tolta e richiesta di nuovo. Le quantità si salvano subito su Cloudflare, indipendentemente da Salva modifiche.

Verifica: tests/stock.test.mjs (set, idempotenza, zero, CORS, preflight, ordini non esposti); prova nel browser: 10 kg impostati dalla gestione, ordine di 1 kg dal sito, 9 kg nel sito e nella gestione; prova completa 69/69.
