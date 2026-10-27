"""Roots certifi's CA bundle must not carry."""

import ssl

import certifi


def test_ca_bundle_does_not_trust_emsign_ecc_root_ca_g3():
    # Private keys of intermediate CAs under this root were compromised (GHSA-6q48-6c7w-9gw2).
    roots = ssl.create_default_context(cafile=certifi.where()).get_ca_certs()
    names = {value for root in roots for rdn in root["subject"] for key, value in rdn if key == "commonName"}
    assert "emSign ECC Root CA - G3" not in names
