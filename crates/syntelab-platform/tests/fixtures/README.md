# Test fixtures

`test-signer.pfx` holds a certificate made only for the tests of this crate
(self-signed, "Syntelab Test Signer", password `test-only`). It signs nothing
real and no computer trusts it. Made with:

    openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 36500 -subj "/CN=Syntelab Test Signer/O=Syntelab tests"
    openssl pkcs12 -export -inkey key.pem -in cert.pem -out test-signer.pfx -passout pass:test-only
