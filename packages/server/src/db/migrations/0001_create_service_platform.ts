import * as Effect from "effect/Effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

export default Effect.gen(function*() {
  const sql = yield* SqlClient;

  yield* sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  yield* sql`
    CREATE TABLE technicians (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      phone_number TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE technician_specialties (
      technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
      appliance_type TEXT NOT NULL,
      PRIMARY KEY (technician_id, appliance_type)
    )
  `;

  yield* sql`
    CREATE TABLE technician_service_zip_codes (
      technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
      zip_code TEXT NOT NULL,
      PRIMARY KEY (technician_id, zip_code)
    )
  `;

  yield* sql`
    CREATE TABLE availability_slots (
      id UUID PRIMARY KEY,
      technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
      appliance_type TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      booked_appointment_id UUID NULL UNIQUE
    )
  `;

  yield* sql`
    CREATE TABLE call_sessions (
      id UUID PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT NULL,
      zip_code TEXT NULL,
      appliance_type TEXT NULL,
      status TEXT NOT NULL,
      transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
      symptom_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
      next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      latest_assistant_message TEXT NOT NULL DEFAULT '',
      appointment_id UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  yield* sql`
    CREATE TABLE appointments (
      id UUID PRIMARY KEY,
      call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
      slot_id UUID NOT NULL UNIQUE REFERENCES availability_slots(id) ON DELETE RESTRICT,
      technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
      customer_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      appliance_type TEXT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      confirmation_code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  yield* sql`
    ALTER TABLE availability_slots
    ADD CONSTRAINT availability_slots_booked_appointment_id_fkey
    FOREIGN KEY (booked_appointment_id)
    REFERENCES appointments(id)
    ON DELETE SET NULL
  `;

  yield* sql`
    ALTER TABLE call_sessions
    ADD CONSTRAINT call_sessions_appointment_id_fkey
    FOREIGN KEY (appointment_id)
    REFERENCES appointments(id)
    ON DELETE SET NULL
  `;

  yield* sql`
    CREATE TABLE upload_sessions (
      token TEXT PRIMARY KEY,
      call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      upload_path TEXT NULL,
      analysis_summary TEXT NULL,
      recognized_appliance_type TEXT NULL,
      visible_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
      uploaded_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  yield* sql`
    CREATE TABLE email_deliveries (
      id UUID PRIMARY KEY,
      call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  yield* sql`CREATE INDEX availability_slots_lookup_idx ON availability_slots (zip_code, appliance_type, starts_at)`;
  yield* sql`CREATE INDEX call_sessions_updated_idx ON call_sessions (updated_at DESC)`;
  yield* sql`CREATE INDEX upload_sessions_call_session_idx ON upload_sessions (call_session_id)`;
  yield* sql`CREATE INDEX email_deliveries_call_session_idx ON email_deliveries (call_session_id, created_at DESC)`;

  yield* sql`
    INSERT INTO technicians (id, name, phone_number)
    VALUES
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', 'Avery Stone', '+1-555-0140'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', 'Jordan Price', '+1-555-0141'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', 'Taylor Brooks', '+1-555-0142'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', 'Morgan Ellis', '+1-555-0143'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', 'Skyler Patel', '+1-555-0144'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', 'Cameron Diaz', '+1-555-0145')
  `;

  yield* sql`
    INSERT INTO technician_specialties (technician_id, appliance_type)
    VALUES
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', 'washer'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', 'dryer'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', 'refrigerator'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', 'dishwasher'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', 'oven'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', 'dishwasher'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', 'hvac'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', 'refrigerator'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', 'washer'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', 'oven'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', 'dryer'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', 'hvac')
  `;

  yield* sql`
    INSERT INTO technician_service_zip_codes (technician_id, zip_code)
    VALUES
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', '60601'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', '60602'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', '60601'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', '60603'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', '60604'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', '60605'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', '60605'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', '60606'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', '60602'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', '60607'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', '60606'),
      ('4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', '60607')
  `;

  yield* sql`
    INSERT INTO availability_slots (id, technician_id, appliance_type, zip_code, starts_at, ends_at)
    VALUES
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900001', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', 'washer', '60601', NOW() + INTERVAL '1 day 09:00', NOW() + INTERVAL '1 day 11:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900002', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0011', 'dryer', '60602', NOW() + INTERVAL '1 day 13:00', NOW() + INTERVAL '1 day 15:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900003', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', 'refrigerator', '60601', NOW() + INTERVAL '2 day 08:00', NOW() + INTERVAL '2 day 10:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900004', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0012', 'dishwasher', '60603', NOW() + INTERVAL '2 day 11:00', NOW() + INTERVAL '2 day 13:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900005', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', 'oven', '60605', NOW() + INTERVAL '1 day 10:00', NOW() + INTERVAL '1 day 12:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900006', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0013', 'dishwasher', '60604', NOW() + INTERVAL '3 day 09:00', NOW() + INTERVAL '3 day 11:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900007', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', 'hvac', '60606', NOW() + INTERVAL '1 day 07:00', NOW() + INTERVAL '1 day 09:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900008', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0014', 'refrigerator', '60605', NOW() + INTERVAL '3 day 14:00', NOW() + INTERVAL '3 day 16:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900009', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', 'washer', '60602', NOW() + INTERVAL '2 day 15:00', NOW() + INTERVAL '2 day 17:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900010', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0015', 'oven', '60607', NOW() + INTERVAL '4 day 10:00', NOW() + INTERVAL '4 day 12:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900011', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', 'dryer', '60607', NOW() + INTERVAL '1 day 16:00', NOW() + INTERVAL '1 day 18:00'),
      ('7295fd1f-2bd1-4c3e-88b8-bb51d5900012', '4cebd338-a2b7-4c5e-b4d3-aeb09c1d0016', 'hvac', '60606', NOW() + INTERVAL '5 day 08:00', NOW() + INTERVAL '5 day 10:00')
  `;
});
