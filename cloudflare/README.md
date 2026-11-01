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
- Il pannello usa aggiornamento manuale, si apre sugli ordini nuovi, confermati e pronti di tutte le date, ordinati per ritiro. Include anche ordini rimasti aperti con data passata. Il filtro per giorno è facoltativo; Tutti include anche ritirati e annullati. Mostra fino a 500 ordini per vista, e se sono di più chiede una data senza mostrare un elenco incompleto. I totali si riferiscono alla vista selezionata e non conserva la chiave in localStorage. La chiave resta in memoria e viene persa ricaricando la pagina. La scheda Pagato indica una registrazione manuale, non un pagamento online.
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
