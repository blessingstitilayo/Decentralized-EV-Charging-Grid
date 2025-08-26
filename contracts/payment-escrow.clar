;; PaymentEscrow.clar
;; Core escrow contract for decentralized EV charging payments
;; Handles token locking, oracle confirmation, releases, cancellations, and disputes
;; Integrates with SIP-10 fungible token for energy units (kWh tokens)

;; Import the fungible token trait
(use-trait fungible-token-trait .fungible-token-trait.fungible-token-trait)

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-STATUS u102)
(define-constant ERR-ESCROW-NOT-FOUND u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-INVALID-ORACLE u105)
(define-constant ERR-TIMEOUT-NOT-REACHED u106)
(define-constant ERR-ALREADY-DISPUTED u107)
(define-constant ERR-INVALID-RESOLVER u108)
(define-constant ERR-METADATA-TOO-LONG u109)
(define-constant ERR-INVALID-PARAM u110)
(define-constant ERR-TRANSFER-FAILED u111)
(define-constant ERR-INSUFFICIENT-BALANCE u112)

(define-constant STATUS-PENDING "pending")
(define-constant STATUS-LOCKED "locked")
(define-constant STATUS-COMPLETED "completed")
(define-constant STATUS-CANCELLED "cancelled")
(define-constant STATUS-DISPUTED "disputed")
(define-constant STATUS-RESOLVED "resolved")

(define-constant MAX-METADATA-LEN u500)
(define-constant DEFAULT-TIMEOUT-BLOCKS u144) ;; ~1 day in blocks

;; Data Variables
(define-data-var contract-admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var oracle principal tx-sender) ;; Default to deployer, can be updated
(define-data-var resolver principal tx-sender) ;; For disputes
(define-data-var escrow-counter uint u0)
(define-data-var token-contract principal tx-sender) ;; Stores the contract principal of the token

;; Data Maps
(define-map escrows
  { escrow-id: uint }
  {
    driver: principal,
    station: principal,
    amount: uint,
    status: (string-ascii 32),
    create-time: uint,
    timeout-time: uint,
    metadata: (string-utf8 500), ;; Session details like kWh requested, location
    dispute-reason: (optional (string-utf8 200))
  }
)

(define-map escrow-balances
  { escrow-id: uint }
  { locked-amount: uint }
)

(define-map dispute-evidence
  { escrow-id: uint, submitter: principal }
  { evidence: (string-utf8 500), timestamp: uint }
)

;; Private Functions
(define-private (is-admin (caller principal))
  (is-eq caller (var-get contract-admin))
)

(define-private (is-oracle (caller principal))
  (is-eq caller (var-get oracle))
)

(define-private (is-resolver (caller principal))
  (is-eq caller (var-get resolver))
)

(define-private (is-driver (escrow-id uint) (caller principal))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND))))
    (is-eq (get driver escrow) caller)
  )
)

(define-private (is-station (escrow-id uint) (caller principal))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND))))
    (is-eq (get station escrow) caller)
  )
)

(define-private (transfer-to-escrow (amount uint) (sender principal) (token <fungible-token-trait>))
  (try! (as-contract (contract-call? token transfer amount sender (as-contract tx-sender) none)))
  (ok true)
)

(define-private (transfer-from-escrow (amount uint) (recipient principal) (token <fungible-token-trait>))
  (try! (as-contract (contract-call? token transfer amount (as-contract tx-sender) recipient none)))
  (ok true)
)

(define-private (refund-to-driver (escrow-id uint) (token <fungible-token-trait>))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND)))
        (amount (get locked-amount (unwrap! (map-get? escrow-balances {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND)))))
    (try! (transfer-from-escrow amount (get driver escrow) token))
    (map-set escrows {escrow-id: escrow-id} (merge escrow {status: STATUS-CANCELLED}))
    (print {event: "escrow-refunded", escrow-id: escrow-id, amount: amount})
    (ok true)
  )
)

;; Public Functions

;; Admin setup functions
(define-public (set-token-contract (new-token principal))
  (if (is-admin tx-sender)
    (ok (var-set token-contract new-token))
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-oracle (new-oracle principal))
  (if (is-admin tx-sender)
    (ok (var-set oracle new-oracle))
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-resolver (new-resolver principal))
  (if (is-admin tx-sender)
    (ok (var-set resolver new-resolver))
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (pause-contract)
  (if (is-admin tx-sender)
    (ok (var-set paused true))
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (unpause-contract)
  (if (is-admin tx-sender)
    (ok (var-set paused false))
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (transfer-admin (new-admin principal))
  (if (is-admin tx-sender)
    (ok (var-set contract-admin new-admin))
    (err ERR-UNAUTHORIZED)
  )
)

;; Core escrow functions
(define-public (create-escrow (station principal) (amount uint) (timeout uint) (metadata (string-utf8 500)) (token <fungible-token-trait>))
  (let ((escrow-id (+ (var-get escrow-counter) u1))
        (current-time block-height)
        (timeout-time (+ current-time (if (> timeout u0) timeout DEFAULT-TIMEOUT-BLOCKS))))
    (if (var-get paused)
      (err ERR-PAUSED)
      (if (or (<= amount u0) (> (len metadata) MAX-METADATA-LEN))
        (err ERR-INVALID-PARAM)
        (begin
          (try! (transfer-to-escrow amount tx-sender token))
          (map-set escrows
            {escrow-id: escrow-id}
            {
              driver: tx-sender,
              station: station,
              amount: amount,
              status: STATUS-LOCKED,
              create-time: current-time,
              timeout-time: timeout-time,
              metadata: metadata,
              dispute-reason: none
            }
          )
          (map-set escrow-balances {escrow-id: escrow-id} {locked-amount: amount})
          (var-set escrow-counter escrow-id)
          (print {event: "escrow-created", escrow-id: escrow-id, amount: amount, station: station})
          (ok escrow-id)
        )
      )
    )
  )
)

(define-public (confirm-completion (escrow-id uint) (delivered-amount uint) (token <fungible-token-trait>))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND))))
    (if (var-get paused)
      (err ERR-PAUSED)
      (if (not (is-oracle tx-sender))
        (err ERR-INVALID-ORACLE)
        (if (not (is-eq (get status escrow) STATUS-LOCKED))
          (err ERR-INVALID-STATUS)
          (if (> delivered-amount (get amount escrow))
            (err ERR-INVALID-AMOUNT)
            (let ((release-amount delivered-amount)
                  (refund-amount (- (get amount escrow) delivered-amount)))
              (if (> refund-amount u0)
                (try! (transfer-from-escrow refund-amount (get driver escrow) token))
                true
              )
              (try! (transfer-from-escrow release-amount (get station escrow) token))
              (map-set escrows {escrow-id: escrow-id} (merge escrow {status: STATUS-COMPLETED}))
              (print {event: "escrow-completed", escrow-id: escrow-id, released: release-amount, refunded: refund-amount})
              (ok true)
            )
          )
        )
      )
    )
  )
)

(define-public (cancel-escrow (escrow-id uint) (token <fungible-token-trait>))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND)))
        (current-time block-height))
    (if (var-get paused)
      (err ERR-PAUSED)
      (if (not (or (is-driver escrow-id tx-sender) (is-station escrow-id tx-sender)))
        (err ERR-UNAUTHORIZED)
        (if (not (is-eq (get status escrow) STATUS-LOCKED))
          (err ERR-INVALID-STATUS)
          (if (< current-time (get timeout-time escrow))
            (err ERR-TIMEOUT-NOT-REACHED)
            (try! (refund-to-driver escrow-id token))
          )
        )
      )
    )
  )
)

(define-public (dispute-escrow (escrow-id uint) (reason (string-utf8 200)))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND))))
    (if (var-get paused)
      (err ERR-PAUSED)
      (if (not (or (is-driver escrow-id tx-sender) (is-station escrow-id tx-sender)))
        (err ERR-UNAUTHORIZED)
        (if (not (is-eq (get status escrow) STATUS-LOCKED))
          (err ERR-INVALID-STATUS)
          (if (is-some (get dispute-reason escrow))
            (err ERR-ALREADY-DISPUTED)
            (begin
              (map-set escrows {escrow-id: escrow-id} (merge escrow {status: STATUS-DISPUTED, dispute-reason: (some reason)}))
              (print {event: "escrow-disputed", escrow-id: escrow-id, reason: reason})
              (ok true)
            )
          )
        )
      )
    )
  )
)

(define-public (submit-evidence (escrow-id uint) (evidence (string-utf8 500)))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND))))
    (if (not (is-eq (get status escrow) STATUS-DISPUTED))
      (err ERR-INVALID-STATUS)
      (if (not (or (is-driver escrow-id tx-sender) (is-station escrow-id tx-sender)))
        (err ERR-UNAUTHORIZED)
        (if (> (len evidence) MAX-METADATA-LEN)
          (err ERR-METADATA-TOO-LONG)
          (begin
            (map-set dispute-evidence {escrow-id: escrow-id, submitter: tx-sender}
              {evidence: evidence, timestamp: block-height})
            (print {event: "evidence-submitted", escrow-id: escrow-id, submitter: tx-sender})
            (ok true)
          )
        )
      )
    )
  )
)

(define-public (resolve-dispute (escrow-id uint) (release-to-station uint) (token <fungible-token-trait>))
  (let ((escrow (unwrap! (map-get? escrows {escrow-id: escrow-id}) (err ERR-ESCROW-NOT-FOUND)))
        (total-amount (get amount escrow)))
    (if (var-get paused)
      (err ERR-PAUSED)
      (if (not (is-resolver tx-sender))
        (err ERR-INVALID-RESOLVER)
        (if (not (is-eq (get status escrow) STATUS-DISPUTED))
          (err ERR-INVALID-STATUS)
          (if (> release-to-station total-amount)
            (err ERR-INVALID-AMOUNT)
            (let ((refund-to-driver (- total-amount release-to-station)))
              (try! (transfer-from-escrow release-to-station (get station escrow) token))
              (try! (transfer-from-escrow refund-to-driver (get driver escrow) token))
              (map-set escrows {escrow-id: escrow-id} (merge escrow {status: STATUS-RESOLVED}))
              (print {event: "dispute-resolved", escrow-id: escrow-id, released: release-to-station, refunded: refund-to-driver})
              (ok true)
            )
          )
        )
      )
    )
  )
)

;; Read-Only Functions
(define-read-only (get-escrow-details (escrow-id uint))
  (map-get? escrows {escrow-id: escrow-id})
)

(define-read-only (get-escrow-balance (escrow-id uint))
  (map-get? escrow-balances {escrow-id: escrow-id})
)

(define-read-only (get-dispute-evidence (escrow-id uint) (submitter principal))
  (map-get? dispute-evidence {escrow-id: escrow-id, submitter: submitter})
)

(define-read-only (get-contract-status)
  {
    admin: (var-get contract-admin),
    paused: (var-get paused),
    oracle: (var-get oracle),
    resolver: (var-get resolver),
    escrow-count: (var-get escrow-counter),
    token-contract: (var-get token-contract)
  }
)

(define-read-only (get-token-balance (account principal) (token <fungible-token-trait>))
  (contract-call? token get-balance account)
)