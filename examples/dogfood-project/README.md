# Message Ordering Exercise

Implement `orderMessages` in `src/order-messages.js`.

Requirements:

1. Return a new array ordered by priority: `P0`, `P1`, `P2`, then `P3`.
2. Within one priority, order by ascending ISO `created` timestamp.
3. Break equal timestamp ties by ascending `id`.
4. Do not mutate the input array or its records.
5. Add no dependencies.

Run the acceptance check with:

```sh
just check
```

The initial implementation is intentionally incomplete so this directory can be used as a small Mycelial dogfood task.
