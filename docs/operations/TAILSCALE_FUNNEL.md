# Put MIA online with Tailscale Funnel (free HTTPS address)

Tailscale Funnel gives the computer running MIA a fixed, free HTTPS address like:

```
https://my-pc.tail1234.ts.net
```

You can open MIA from your phone with it, and paste it into Privy's **Allowed origins**. You don't need to buy a domain, open router ports or set up certificates.

> **Funnel makes MIA's login page reachable by anyone on the internet.** It stays protected by your passphrase, lockout after wrong guesses, the one-time setup code, and paper-only trading (Live is locked). Turn Funnel off whenever you don't need it (step 8).

---

## 1. Run MIA on your computer first

From the MIA folder:

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

1. Open **http://localhost:8787** on that same computer.
2. **Create your owner passphrase now, before turning Funnel on.** Then nobody else can ever claim the owner account.
3. Leave MIA running.

## 2. Install Tailscale

- **Windows / macOS:** download and install from https://tailscale.com/download, open it and sign in. A free personal account is enough.
- **Linux:** run the two commands below.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

```bash
sudo tailscale up
```

`sudo tailscale up` prints a sign-in link. Open it and sign in.

## 3. Turn on HTTPS for your Tailscale network (once)

1. Open https://login.tailscale.com/admin/dns.
2. Make sure **MagicDNS** is enabled.
3. Under **HTTPS Certificates**, press **Enable HTTPS**.

## 4. Start Funnel for MIA

In a terminal on the computer running MIA:

```bash
tailscale funnel 8787
```

On macOS, if `tailscale` is "not found", use the full path:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel 8787
```

- **The first time,** it prints a link asking you to allow Funnel. Open it, approve, and run the command again.
- **It then shows your public address,** for example `https://my-pc.tail1234.ts.net/`. **That is your MIA website.**
- **The command keeps running.** Pressing Ctrl+C stops Funnel. To keep it running in the background instead:

```bash
tailscale funnel --bg 8787
```

The first visit can take up to a minute while Tailscale gets the HTTPS certificate.

## 5. Tell MIA it is served over HTTPS

1. Stop MIA (Ctrl+C).
2. Set these in its environment: your shell, process manager, or the systemd `EnvironmentFile`; see `DEPLOYMENT_GUIDE.md`.

```
MIA_SECURE_COOKIE=1
MIA_PRIVY_APP_ID=<your 25-character Privy App ID>
```

3. Start MIA again (`npm start`).

Notes:
- **Leave `MIA_HOST` unset.** MIA keeps listening only on this computer, and Funnel reaches it locally.
- **`MIA_SECURE_COOKIE=1` keeps your sign-in cookie on HTTPS.** Modern browsers still allow it on `http://localhost`.
- **First-time owner setup always requires the console code.** MIA applies the remote sign-in lockout rules to visitors through Funnel.

## 6. Paste the address into Privy

1. In the Privy dashboard, open your app → **Configuration → App settings → Domains**.
2. Under **Allowed origins**, add both of these, with no trailing slash:

```
https://my-pc.tail1234.ts.net
```

```
http://localhost:8787
```

Use **your** address from step 4 instead of the example. Then follow `PRIVY_SIGN_IN.md` (Turning it on, steps 4–6) to sign in with Privy and set up your authenticator app.

## 7. Check it works

- Open your `https://….ts.net` address on your phone, using mobile data rather than Wi-Fi, to prove it is reachable from outside.
- You should see the MIA sign-in page. Sign in with your passphrase, or with Privy once linked.

## 8. Turn it off

```bash
tailscale funnel --https=443 off
```

To remove every Funnel and Serve setting:

```bash
tailscale funnel reset
```

To see what is currently shared:

```bash
tailscale funnel status
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "Funnel not available" / "not enabled" | Open the link the command prints, or check **Access controls** in the Tailscale admin: the `funnel` attribute must be granted to this machine. |
| Address loads but shows an error page | MIA is not running, or not on port 8787: run `npm start` and check http://localhost:8787. |
| Certificate or "connection not private" error | Wait a minute on the first visit, and confirm **HTTPS Certificates** are enabled (step 3). |
| Privy says the origin is not allowed | The address in Privy must match exactly: `https://`, no trailing slash, no port. |
| Computer sleeps → site goes down | Funnel only works while that computer is on and awake. |
