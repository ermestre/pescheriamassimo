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
- Il pannello usa aggiornamento manuale, mostra fino a 500 ordini della data scelta e non conserva la chiave in localStorage. La chiave resta in memoria e viene persa ricaricando la pagina. La scheda Pagato indica una registrazione manuale, non un pagamento online.
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
