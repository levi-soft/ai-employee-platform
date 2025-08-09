
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Helper functions for database migrations
 */

export const createIndexIfNotExists = async (
  tableName: string,
  indexName: string,
  columns: string[],
  unique: boolean = false
) => {
  const uniqueClause = unique ? 'UNIQUE ' : ''
  const columnsList = columns.join(', ')
  
  try {
    await prisma.$executeRawUnsafe(`
      CREATE ${uniqueClause}INDEX IF NOT EXISTS ${indexName}
      ON ${tableName} (${columnsList});
    `)
    console.log(`✅ Created index: ${indexName} on ${tableName}`)
  } catch (error) {
    console.error(`❌ Failed to create index ${indexName}:`, error)
    throw error
  }
}

export const dropIndexIfExists = async (indexName: string) => {
  try {
    await prisma.$executeRawUnsafe(`
      DROP INDEX IF EXISTS ${indexName};
    `)
    console.log(`🗑️ Dropped index: ${indexName}`)
  } catch (error) {
    console.error(`❌ Failed to drop index ${indexName}:`, error)
    throw error
  }
}

export const addColumnIfNotExists = async (
  tableName: string,
  columnName: string,
  columnDefinition: string
) => {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${tableName}
      ADD COLUMN IF NOT EXISTS ${columnName} ${columnDefinition};
    `)
    console.log(`✅ Added column: ${columnName} to ${tableName}`)
  } catch (error) {
    console.error(`❌ Failed to add column ${columnName}:`, error)
    throw error
  }
}

export const dropColumnIfExists = async (tableName: string, columnName: string) => {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${tableName}
      DROP COLUMN IF EXISTS ${columnName};
    `)
    console.log(`🗑️ Dropped column: ${columnName} from ${tableName}`)
  } catch (error) {
    console.error(`❌ Failed to drop column ${columnName}:`, error)
    throw error
  }
}

export const renameColumnIfExists = async (
  tableName: string,
  oldColumnName: string,
  newColumnName: string
) => {
  try {
    // Check if old column exists
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = $2;
    `, tableName, oldColumnName)

    if (Array.isArray(result) && result.length > 0) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE ${tableName}
        RENAME COLUMN ${oldColumnName} TO ${newColumnName};
      `)
      console.log(`✅ Renamed column: ${oldColumnName} to ${newColumnName} in ${tableName}`)
    } else {
      console.log(`ℹ️ Column ${oldColumnName} doesn't exist in ${tableName}`)
    }
  } catch (error) {
    console.error(`❌ Failed to rename column ${oldColumnName}:`, error)
    throw error
  }
}

export const createEnumIfNotExists = async (enumName: string, values: string[]) => {
  const valuesList = values.map(v => `'${v}'`).join(', ')
  
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE ${enumName} AS ENUM (${valuesList});
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `)
    console.log(`✅ Created enum: ${enumName}`)
  } catch (error) {
    console.error(`❌ Failed to create enum ${enumName}:`, error)
    throw error
  }
}

export const addEnumValue = async (enumName: string, value: string) => {
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS '${value}';
    `)
    console.log(`✅ Added value '${value}' to enum: ${enumName}`)
  } catch (error) {
    console.error(`❌ Failed to add enum value ${value}:`, error)
    throw error
  }
}
