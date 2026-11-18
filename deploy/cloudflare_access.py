#!/usr/bin/env python3
"""
Idempotent Cloudflare Zero Trust setup for Output VAT.

Creates (or reuses):
  * a One-time PIN identity provider (email codes)
  * Access app  "VAT"             -> WEB_HOST/app + WEB_HOST/api (allow: listed emails, OTP login).
                                     WEB_HOST/ (landing page + static assets) stays public, which
                                     also lets Netlify renew its certificate behind the proxy.
  * service token "output-vat-netlify-proxy" (used by the Netlify edge function)
  * Access app  "VAT API"         -> API_HOST   (allow: that service token only)
  * DNS CNAME   WEB_HOST -> NETLIFY_TARGET (optional, --netlify-target)

Prints the AUD tags. A NEW service token's secret is written to --secret-out (0600) and
never printed. Token is read from --token-file (needs Access: Apps and Policies Edit,
Access: Service Tokens Edit, Zone DNS Edit).

Usage:
  deploy/cloudflare_access.py --token-file ~/.ovat-cf-token --zone stanleyowen.com \
      --web vat.stanleyowen.com --api vat-api.stanleyowen.com \
      --emails a@x.com,b@y.com --secret-out ~/.ovat-service-token.json \
      [--netlify-target site.netlify.app] [--proxied]
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4"


class CF:
    def __init__(self, token: str):
        self.token = token

    def call(self, method: str, path: str, body=None):
        req = urllib.request.Request(
            API + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            data = json.load(e)
        if not data.get("success"):
            raise SystemExit(f"Cloudflare API {method} {path} failed: {json.dumps(data.get('errors'))}")
        return data["result"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token-file", required=True)
    ap.add_argument("--zone", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--api", required=True)
    ap.add_argument("--emails", required=True)
    ap.add_argument("--secret-out", required=True)
    ap.add_argument("--netlify-target")
    ap.add_argument("--edge-secret-file", help="file holding the shared header secret for the Netlify edge function")
    ap.add_argument("--proxied", action="store_true", help="orange-cloud the web CNAME (do this after Netlify issued its cert)")
    a = ap.parse_args()

    cf = CF(open(os.path.expanduser(a.token_file)).read().strip())
    emails = [e.strip().lower() for e in a.emails.split(",") if e.strip()]

    zone = cf.call("GET", f"/zones?name={a.zone}")[0]
    acc = zone["account"]["id"]
    zid = zone["id"]
    print(f"zone {a.zone} ({zid}), account {acc}")
    ssl = cf.call("GET", f"/zones/{zid}/settings/ssl")["value"]
    print(f"zone SSL mode: {ssl}")

    # 1. One-time PIN identity provider
    idps = cf.call("GET", f"/accounts/{acc}/access/identity_providers")
    otp = next((i for i in idps if i["type"] == "onetimepin"), None)
    if not otp:
        otp = cf.call("POST", f"/accounts/{acc}/access/identity_providers", {"name": "One-time PIN", "type": "onetimepin", "config": {}})
        print("created One-time PIN login method")

    # 2. Service token for the Netlify edge proxy
    tokens = cf.call("GET", f"/accounts/{acc}/access/service_tokens")
    st = next((t for t in tokens if t["name"] == "output-vat-netlify-proxy"), None)
    if not st:
        st = cf.call("POST", f"/accounts/{acc}/access/service_tokens", {"name": "output-vat-netlify-proxy", "duration": "8760h"})
        out = os.path.expanduser(a.secret_out)
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(fd, 0o600)  # O_CREAT's mode doesn't apply to an existing file
        with os.fdopen(fd, "w") as f:
            json.dump({"client_id": st["client_id"], "client_secret": st["client_secret"]}, f)
        print(f"created service token; credentials written to {out} (0600)")
    else:
        print("service token exists (secret not retrievable; delete it in the dashboard to rotate)")

    # 3. Reusable policies
    pols = cf.call("GET", f"/accounts/{acc}/access/policies")

    def policy(name, body):
        p = next((x for x in pols if x["name"] == name), None)
        body = {"name": name, **body}
        if p:
            return cf.call("PUT", f"/accounts/{acc}/access/policies/{p['id']}", body)
        return cf.call("POST", f"/accounts/{acc}/access/policies", body)

    p_users = policy("Output VAT users", {"decision": "allow", "include": [{"email": {"email": e}} for e in emails], "session_duration": "24h"})
    p_svc = policy("Output VAT proxy token", {"decision": "non_identity", "include": [{"service_token": {"token_id": st["id"]}}]})

    # 4. Applications
    apps = cf.call("GET", f"/accounts/{acc}/access/apps")

    def app(name, domain, policy_ids, extra, destinations=None):
        body = {
            "name": name,
            "domain": domain,
            **({"destinations": [{"type": "public", "uri": d} for d in destinations]} if destinations else {}),
            "type": "self_hosted",
            "session_duration": "24h",
            "app_launcher_visible": False,
            "http_only_cookie_attribute": True,
            "same_site_cookie_attribute": "lax",
            "policies": [{"id": pid, "precedence": i + 1} for i, pid in enumerate(policy_ids)],
            **extra,
        }
        ex = next((x for x in apps if x.get("domain") == domain), None)
        if ex:
            return cf.call("PUT", f"/accounts/{acc}/access/apps/{ex['id']}", body)
        return cf.call("POST", f"/accounts/{acc}/access/apps", body)

    web = app(
        "VAT",
        f"{a.web}/app",
        [p_users["id"]],
        {"allowed_idps": [otp["id"]], "auto_redirect_to_identity": True, "logo_url": f"https://{a.web}/icon-192.png"},
        destinations=[f"{a.web}/app", f"{a.web}/api"],
    )
    api = app("VAT API", a.api, [p_svc["id"]], {})
    # Superseded: the root is public now, so the ACME bypass app is no longer needed.
    for x in apps:
        if x.get("name") in ("Output VAT ACME", "Output VAT edge check (temporary)"):
            cf.call("DELETE", f"/accounts/{acc}/access/apps/{x['id']}")
            print(f"deleted superseded app {x['name']}")

    # 5. DNS for the web host
    if a.netlify_target:
        recs = cf.call("GET", f"/zones/{zid}/dns_records?name={a.web}")
        body = {"type": "CNAME", "name": a.web, "content": a.netlify_target, "proxied": bool(a.proxied), "ttl": 1, "comment": "Output VAT (Netlify)"}
        if recs:
            cf.call("PUT", f"/zones/{zid}/dns_records/{recs[0]['id']}", body)
        else:
            cf.call("POST", f"/zones/{zid}/dns_records", body)
        print(f"DNS {a.web} -> {a.netlify_target} proxied={bool(a.proxied)}")

    # 6. Transform Rule: inject a shared secret header on the web host so the Netlify edge
    #    function can tell requests that came through Cloudflare (and Access) from direct ones.
    if a.edge_secret_file:
        secret = open(os.path.expanduser(a.edge_secret_file)).read().strip()
        phase = f"/zones/{zid}/rulesets/phases/http_request_late_transform/entrypoint"
        try:
            rules = cf.call("GET", phase).get("rules", [])
        except SystemExit:
            rules = []  # no entrypoint ruleset yet
        desc = "Output VAT: prove traffic came through Cloudflare"
        keep = [
            {k: r[k] for k in ("action", "expression", "description", "enabled", "action_parameters") if k in r}
            for r in rules
            if r.get("description") != desc
        ]
        keep.append(
            {
                "description": desc,
                "expression": f'(http.host eq "{a.web}")',
                "action": "rewrite",
                "enabled": True,
                "action_parameters": {"headers": {"x-ovat-edge": {"operation": "set", "value": secret}}},
            }
        )
        cf.call("PUT", phase, {"rules": keep})
        print(f"transform rule set (x-ovat-edge on {a.web}); {len(keep) - 1} other rule(s) preserved")

    print(json.dumps({"CF_ACCESS_TEAM_DOMAIN": None, "CF_ACCESS_WEB_AUD": web["aud"], "CF_ACCESS_API_AUD": api["aud"]}, indent=2))


if __name__ == "__main__":
    sys.exit(main())
