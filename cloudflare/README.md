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
