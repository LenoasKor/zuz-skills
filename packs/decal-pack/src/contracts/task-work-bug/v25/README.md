# Registration lock with Windows denial retry v25

Copy of published v15 with two changes in `registration-lock.mjs`. Windows answers EPERM, not EEXIST, while another
process is deleting the lock file, and v15 failed the registration on it. v25 retries that EPERM for up to five
consecutive seconds on Windows and then fails with the same error. Formats, number assignment, commits and receipts match v15.

It also stops calling a lock unsafe when the holder releases it between the two looks at the file (a link count of zero or
a new inode). That race made v15 fail with `unsafe_repository_lock` under load. Hard links and symbolic links stay refused.

`capabilities.json` selects v25 only on win32. Other platforms keep v15, and v25 behaves like v15 there.

Observed on Windows: eight processes creating and deleting one file for 15 seconds gave 1,040 EPERM from open and 1,573
from read. That the file is pending deletion is an inference, not a direct observation.

Not included: other contracts that use the same lock file (v6 to v14, v18, v22). No push, merge, deploy or settlement.
