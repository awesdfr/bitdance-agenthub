# Future Architecture Reservations

Section 51 is implemented as explicit architecture evolution reservations.

## Records

`architecture_evolution_reservations` stores the interface or replacement point, the current local-first implementation, the future implementation, and the trigger that should justify migration.

## Default Reservations

- `IEventBus`: in-process events to Redis Streams or NATS.
- `IStorage`: SQLite and local filesystem to PostgreSQL/LiteFS and shared or object storage.
- `ILockService`: local resource locks to Redis or etcd distributed locks.
- `IRuntimeWorker`: local Agent Runtime to optional cloud workers.
- `IDeploymentTarget`: desktop app to SaaS or private deployment.
- `IMobileAgentSurface`: companion progress APIs to voice tasks, image upload, AR status, and mobile app-control adapters.

## API

- `POST /api/future-architecture/reservations/seed`
- `GET /api/future-architecture/reservations`
- `POST /api/future-architecture/reservations`
- `POST /api/future-architecture/reservations/evaluate`

## Rule

v1 remains local-first. These records reserve interfaces and migration paths without turning the product into a cloud-first or distributed system prematurely.
