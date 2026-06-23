# Enterprise Network Adaptation

Section 92 records enterprise network requirements before Agents route model, browser, CLI, or Python traffic.

## Covered Areas

- Corporate proxy modes: HTTP, HTTPS, SOCKS5, PAC, and system proxy discovery.
- Proxy authentication: none, basic, NTLM, Kerberos, and negotiate.
- Secret handling: proxy passwords must be passed as Secret Vault references, not plaintext.
- Tool-specific routing: Node.js proxy agents, browser proxy injection, and Python `requests-ntlm` guidance.
- noProxy hygiene: local loopback entries should remain bypassed.
- Enterprise certificates: self-signed certificates, corporate CA bundles, SSL inspection, and missing CA bundles.

## Certificate Environment Guidance

- Browser traffic should use the system certificate store where possible.
- Node and generic CLI tools can use `NODE_EXTRA_CA_CERTS` or `SSL_CERT_FILE`.
- Python requests can use `REQUESTS_CA_BUNDLE`.
- Manual certificate trust requires user or IT approval.

## APIs

- `POST /api/enterprise-network/policies/seed`
- `GET /api/enterprise-network/policies?status=active`
- `POST /api/enterprise-network/evaluate`
- `GET /api/enterprise-network/evaluations?status=needs_user`

## Safety Boundary

The service does not modify system proxy settings, install certificates, disable TLS verification, or make outbound network calls. It records recommendations for approved runtime adapters.
