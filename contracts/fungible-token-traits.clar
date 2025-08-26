;; fungible-token-trait.clar
;; Standard SIP-10 fungible token trait definition

(define-trait fungible-token-trait
  (
    ;; Transfer tokens from one principal to another
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    ;; Get the balance of a principal
    (get-balance (principal) (response uint uint))
    ;; Get token metadata
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-total-supply () (response uint uint))
  )
)