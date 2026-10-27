"""Roots the CA bundle of the webhook's HTTPS clients (requests, httpx, botocore) must not carry."""

import certifi
from cryptography import x509
from cryptography.x509.oid import NameOID


def test_ca_bundle_does_not_trust_emsign_ecc_root_ca_g3():
    # Private keys of intermediate CAs under this root were compromised (GHSA-6q48-6c7w-9gw2).
    with open(certifi.where(), "rb") as f:
        roots = x509.load_pem_x509_certificates(f.read())
    names = {attr.value for root in roots for attr in root.subject.get_attributes_for_oid(NameOID.COMMON_NAME)}
    assert "emSign ECC Root CA - G3" not in names
