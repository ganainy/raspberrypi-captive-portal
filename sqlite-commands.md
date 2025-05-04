# Helpful SQLite Commands for Session Database

This guide provides common SQLite commands to inspect the session database used by the `local-server-to-remote-server-connector`.

1.  **Open the database:**
    Replace `/path-to-db/[DB_NAME].db` with the actual path and filename specified in your `local-server-to-remote-server-connector/.env` file (e.g., `/opt/captive-portal-listener-node/sessions.db`).
    ```bash
    sqlite3 /path-to-db/[DB_NAME].db 
    ```

2.  **Enable better formatting:**
    These commands improve readability in the SQLite shell.
    ```sql
    .headers on
    .mode column
    ```

3.  **View tables:**
    Lists all tables in the database (should show `sessions`).
    ```sql
    .tables
    ```

4.  **Show table schema:**
    Displays the structure (columns and data types) of the `sessions` table.
    ```sql
    .schema sessions
    ```

5.  **View table content:**
    Shows all rows and columns in the `sessions` table.
    ```sql
    SELECT * FROM sessions;
    ```

6.  **Exit SQLite:**
    ```sql
    .exit
    ```
