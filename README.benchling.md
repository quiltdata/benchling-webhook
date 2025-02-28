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
   - Click on your **profile icon** (top-right corner).
   - Select **"Feature Settings"**.
   - Click on **"Developer Console"**.

### **Step 2: Create a New App**

1. In the **"Apps"** section, click **"Create"**.
2. Choose **"From scratch"**.
3. Provide the following details:
   - **App Name**: A descriptive name (e.g., `Notebook Webhook Listener`).
   - **Description**: A brief summary of the app's purpose.
4. Click **"Create"**.

---

## **3. Configuring the Webhook Subscription**

Now, configure the app to send data to your webhook.

### **Step 1: Define Event Subscriptions**

1. In the app's settings, go to **"Subscriptions"**.
2. Click **"Add Subscription"**.
3. Configure the subscription:
   - **Delivery Method**: Select **"WEBHOOK"**.
   - **Webhook URL**: Enter your existing webhook endpoint (e.g., `https://your-webhook-endpoint.com`).
   - **Events**: Select relevant events, such as:
     - `entry.created` – Triggered when a notebook entry is created.
     - `entry.updated` – Triggered when an entry is modified.
     - `entry.completed` – Triggered when an entry is finalized.
4. Click **"Save"**.

### **Step 2: Set Up Security (Optional)**

For **secure communication** between Benchling and your webhook:

- **Secret Token**: Define a token in the app settings. Benchling will include this in webhook requests, allowing verification.
- **Restrict Webhook Access**: Use firewall rules to allow only Benchling IPs.

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
