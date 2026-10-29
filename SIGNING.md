# Signing the Windows installer

Unsigned installers make Windows show "Unknown publisher" (and SmartScreen's "Windows protected your PC"). Signing puts your name on the installer, the app and the uninstaller. The build workflow signs automatically once one of the options below is set up, and builds unsigned when nothing is set.

Since 2023, code signing certificates can't be issued as plain `.pfx` files any more: the key has to live on a hardware token or in a cloud service. That leaves two practical routes for builds in GitHub Actions.

## Option 1: Azure Artifact Signing (formerly Trusted Signing)

A monthly subscription from Microsoft; Microsoft holds the key and the workflow signs through their API.

1. In the [Azure portal](https://portal.azure.com), create an **Artifact Signing account** (it may still be called Trusted Signing). Note its region endpoint, for example `https://eus.codesigning.azure.net/`.
2. Under **Identity validation**, verify yourself as an individual or your organization. Availability for individuals depends on your country; the portal says whether it's offered for you. Validation can take a few days.
3. Create a **certificate profile** of type Public Trust using that identity.
4. In Microsoft Entra ID, create an **app registration** with a client secret, and give it the **Artifact Signing Certificate Profile Signer** role (Trusted Signing Certificate Profile Signer) on the signing account.
5. In the GitHub repository, go to Settings > Secrets and variables > Actions:
   - Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - Variables: `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT` (the signing account name), `AZURE_SIGN_PROFILE` (the certificate profile name), `AZURE_SIGN_PUBLISHER` (the name exactly as on the certificate)

## Option 2: a certificate file

If you have an OV or EV certificate whose provider lets you export it as a `.pfx` (or a test certificate), add it as secrets:

- `WIN_CSC_LINK`: the `.pfx` file, base64-encoded (`certutil -encode cert.pfx cert.txt`, then paste the text between the BEGIN and END lines)
- `WIN_CSC_KEY_PASSWORD`: its password

Certificates kept on a USB token or in a vendor's cloud (SSL.com eSigner, Certum SimplySign, DigiCert KeyLocker and others) need that vendor's signing tool, which this workflow doesn't call yet.

For open-source projects, [SignPath Foundation](https://signpath.org/) offers free signing after they review the project; it plugs into GitHub Actions with its own action.

## After signing

The installer shows your name as the publisher straight away. SmartScreen can still warn about a new certificate until enough people have downloaded the app.
