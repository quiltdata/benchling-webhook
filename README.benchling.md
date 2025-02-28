# **Connecting a Webhook to Benchling via an App**

This guide walks you through integrating an **existing webhook** with Benchling by creating a **Benchling App** and subscribing to events.

---

## **1. Prerequisites**

Before proceeding, ensure you have:

- **Benchling Tenant Admin Access**: Permissions to create and manage apps.
- **A Public HTTPS Endpoint**: Your webhook URL that can receive POST requests.
- **API Credentials** (if required for authentication).

---

## **2. Creating a Benchling App**

Benchling requires an **app** to manage webhook subscriptions. Follow these steps to create one.

### **Step 1: Access the Developer Console**

1. **Log in to Benchling**.
2. **Navigate to the Developer Console**:
   - Click on your **profile icon** (lower-left corner).
   - Select **"Feature Settings"**.
   - Click on **"Developer Console"**.

### **Step 2: Create a New App**

1. In the **"Apps"** section, click **"Create app"**.
2. Choose **"From scratch"**.
3. Provide the following details:
   - **Name**: A short label (e.b., "entry-webhook").
   - **Description**: A brief summary of the app's purpose.
4. Leave it as Private, or make Public.
5. Click **"Create"**.

---

## **3. Configuring the Webhook Subscription**

Now, configure the app to send data to your webhook.

### **Step 1: Define Event Subscriptions**

1. In the app's settings, find "Webhook URL" (under Overview -> Global Information).
2. Click the edit icon
3. Paste in your webhook URL.
4. Click checkmark to save.

NOTE: Enter the top-level endpoint; Benchling will send to the appropriate
path underneath that:

- assayRun: /event
- configuration: /lifecycle
- canvas: /canvas
- entry: /event
- request: /event
- workflow: /event

### **Step 2: Webhook Testing**

1. Go to the **"Webhook Testing"** tab.
2. Under "**Preview**", select one of the "/event" options.
3. Click **"Send Test"**.
4. Confirm that the "**Test**" tab shows "Success"
5. Verify that a package was properly created.

### **Step 3: Add App To Your Tenant**

1. Go back to Home (the Benchling jellyfish logo in the upper right).
2. Go to the Tenant Admin Console (from your profile icon).
3. Select your organization.
4. Select Apps under your organization (NOT from your Tenant)

---
