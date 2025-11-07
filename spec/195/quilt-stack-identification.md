# Quilt Stack Identification Algorithm

## Problem Statement

We need to quickly identify Quilt vs non-Quilt CloudFormation stacks in a region. The essential characteristic is a `QuiltWebHost` output parameter, but CloudFormation API doesn't support server-side filtering by output keys.

## Investigation Results

### Key Findings

1. **QuiltWebHost Output**: All Quilt catalog deployment stacks have a `QuiltWebHost` output
   - Example: `quilt-staging` in us-east-1
   - This is the most reliable identifier

2. **QuiltWebHost Parameter**: Some Quilt stacks also have a `QuiltWebHost` parameter (input)
   - Not all Quilt stacks have this (e.g., older deployments)
   - Less reliable than the output

3. **No Server-Side Filtering**: CloudFormation API does not support:
   - Filtering by output keys
   - Filtering by parameter keys
   - Filtering by specific tag patterns (Quilt stacks don't have consistent tags)

4. **Other Distinguishing Features**:
   - `PackagerQueueUrl` output (also present in Quilt stacks)
   - `TemplateBuildMetadata` output (contains Quilt deployment info)
   - `UserAthenaDatabaseName` output (Athena database)
   - Load balancer resources (ELBv2)

### Test Results

#### us-east-1
- Total stacks: 11
- Quilt stacks found: 1
  - `quilt-staging` (nightly.quilttest.com)

#### us-east-2
- Total stacks: 8
- Quilt stacks found: 4
  - `tf-dev-bench` (bench.dev.quilttest.com)
  - `tf-dev-crc` (crc.dev.quilttest.com)
  - `tf-dev-mcp-demo` (mcp-demo.dev.quilttest.com)
  - `tf-stable` (stable.quilttest.com)

## Solution Algorithm

Since server-side filtering is not available, the optimal approach is:

1. **List all stacks** using `cloudformation list-stacks` with relevant status filters
   - Status filters: `CREATE_COMPLETE`, `UPDATE_COMPLETE`, `UPDATE_ROLLBACK_COMPLETE`
   - This is a single API call that returns all stacks

2. **Filter client-side** by checking each stack for `QuiltWebHost` output
   - Query: `Stacks[0].Outputs[?OutputKey=='QuiltWebHost'] | length(@)`
   - Returns 1 or more if Quilt stack, 0 otherwise
   - Suppress stderr to avoid errors for stacks without outputs

3. **Retrieve full details** only for identified Quilt stacks
   - Gets all outputs including `QuiltWebHost`, `PackagerQueueUrl`, etc.

### Performance Considerations

- **API Calls**: N+1 where N = number of stacks
  - 1 call to list all stacks
  - N calls to check each stack (parallelizable)
  - M additional calls for full details (M = number of Quilt stacks)

- **Optimization**: Could be further optimized by:
  - Parallel checking of stacks (AWS SDK supports this)
  - Caching results with TTL
  - Early termination if only looking for specific stack

### Why This Is The Best Approach

1. **Reliability**: `QuiltWebHost` output is present in all Quilt catalog deployments
2. **API Limitations**: No server-side filtering available from CloudFormation
3. **Efficiency**: Minimizes API calls by filtering early
4. **Accuracy**: 100% accurate based on documented Quilt stack structure

## Implementation

A reference implementation is available in [scripts/list-quilt-stacks.ts](../../scripts/list-quilt-stacks.ts).

### Usage Examples

```bash
# List Quilt stacks in default region (us-east-1)
npx ts-node scripts/list-quilt-stacks.ts

# List Quilt stacks in specific region
npx ts-node scripts/list-quilt-stacks.ts --region=us-east-2

# Verbose output showing progress
npx ts-node scripts/list-quilt-stacks.ts --region=us-east-1 --verbose

# JSON output for scripting
npx ts-node scripts/list-quilt-stacks.ts --region=us-east-1 --json
```

### Integration with Existing Code

The filtering logic can be integrated into [lib/utils/stack-inference.ts](../../lib/utils/stack-inference.ts) to replace or augment the existing `findStack()` function.

Key functions to export:
- `hasQuiltWebHostOutput(region, stackName)`: Check if single stack is Quilt
- `findQuiltStacks(region)`: Find all Quilt stacks in region

## Alternative Approaches Considered

1. **Filter by Tags**: Quilt stacks don't have consistent identifying tags
2. **Filter by Parameters**: Not all Quilt stacks have `QuiltWebHost` parameter
3. **Filter by Resource Types**: Too broad (many stacks use ELBv2)
4. **Filter by Stack Name Pattern**: Unreliable (names like `TitanicStack`, `quilt-staging`, `tf-stable` vary)

## Recommendations

1. **Use `QuiltWebHost` output** as the canonical identifier
2. **Implement caching** if this check is performed frequently
3. **Add to stack-inference.ts** as a utility function
4. **Consider pagination** if regions have >100 stacks (unlikely but possible)

## Related Files

- [scripts/list-quilt-stacks.ts](../../scripts/list-quilt-stacks.ts) - Standalone script
- [lib/utils/stack-inference.ts](../../lib/utils/stack-inference.ts) - Existing stack inference code
- [bin/commands/infer-quilt-config.ts](../../bin/commands/infer-quilt-config.ts) - Setup wizard stack detection
