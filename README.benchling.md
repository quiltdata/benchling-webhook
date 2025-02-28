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

> NOTE: Use the top-level endpoint; Benchling will send to "/event" under that.

### **Step 2: Add App To Your Tenant**

1. Go back to Home (the Benchling jellyfish logo in the upper right).
2. Go to the Tenant Admin Console (from your profile icon).
3. Select your organization.
4. Select Apps under your organization (NOT from your Tenant)

---

## **4. Granting the App Access to Data**

By default, the new app has **no access** to data. You need to grant it permissions.

1. **Navigate to the App's Access Settings**:
   - In the app's settings, go to **"Access"**.
2. **Assign the App to Relevant Projects or Teams**:
   - Add the app to the projects or teams it needs to access.
   - Follow **least privilege** principles.

---

## **5. Testing the Webhook Integration**

Before deploying, verify that the integration is working.

### **Step 1: Trigger an Event**

Perform an action in Benchling that corresponds to a subscribed event (e.g., create a new entry).

### **Step 2: Monitor Your Webhook**

- Ensure your server **receives** the POST request.
- Validate the **JSON payload**:

```json
{
  "event": "entry.updated",
  "timestamp": "2024-02-18T12:34:56Z",
  "data": {
    "id": "etr_1234567890abcdef",
    "schema": "Notebook Entry",
    "modifiedBy": "user@example.com",
    "fields": {
      "title": "Updated Experiment",
      "status": "Finalized"
    }
  }
}
```
