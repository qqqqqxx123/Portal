# DFIR Portal

Portal with **DF** (Digital Forensics) and **IR** (Incident Response) entry points. The DF flow shows an upload form that submits to your n8n webhook.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click **DF** to open the upload form.

## DF form

- **Team** (required): CYB TRG, CW CSD, DFRN FTD  
- **Videos to be uploaded** (required): up to 10 video files  
- **Source**: Public Members, Online Media, Government Systems, Others  
- **Media URL**: optional  
- **Recipient Email Address** (required): validated as email  

Submit sends **multipart/form-data** to your webhook with:

- `payload`: JSON array in the format expected by n8n (Team, "Videos to be uploaded" metadata, "Source ", "Media URL ", Recipient Email Address, submittedAt, formMode).
- `Videos to be uploaded`: the actual video files (multiple).

Your n8n workflow can parse the `payload` field as JSON and use the file parts for processing.
