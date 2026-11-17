# Safety and recovery

Existing deterministic risk veto, pause-new-orders, emergencyStop, eligible pending-entry cancellation, position monitoring, protection checks, owner step-up recovery and live release gate remain authoritative. DITAS uses the existing controls and adds no execution/resume authority. A database capture failure aborts before scanner execution callback. Corrupt data fails the existing risk path through the unified quality service.

Unified operational incidents for reconciliation faults/provider/model/database outages, automated escalation and durable incident-specific recovery approvals remain follow-on work. There is no automatic liquidation or unreviewed strategy promotion. Current UI links Risk Center for controls. Operational stress/certified recovery evidence is still required; offline metric tests do not prove production recovery.
