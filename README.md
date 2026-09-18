# slotlock

A coworking-space reservation API that cannot double-book: five ways to serialise a booking
(advisory lock, `SELECT … FOR UPDATE`, optimistic versioning, `SERIALIZABLE`, an exclusion
constraint), each proven by tests and measured under the same load.

Work in progress — assembled in small pull requests; the README grows with the benchmark results.
