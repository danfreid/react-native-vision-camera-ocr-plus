package com.rnvisioncameraocr

import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlin.math.abs

class DocumentRecognizerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    @ReactMethod
    fun process(uri: String, promise: Promise) {
        try {
            val parsedUri = Uri.parse(uri)
            val image = InputImage.fromFilePath(this.reactApplicationContext, parsedUri)
            val task = recognizer.process(image)
            val text = Tasks.await(task)
            
            val result = inferTableStructure(text)
            promise.resolve(result)
        } catch (e: Exception) {
            e.printStackTrace()
            promise.reject("Error", "Error processing document: ${e.message}")
        }
    }

    /**
     * Infers table structure from text recognition results by analyzing spatial relationships
     */
    private fun inferTableStructure(text: Text): WritableMap {
        val result = WritableNativeMap()
        val tablesArray = WritableNativeArray()
        val allText = StringBuilder()

        // Collect all text elements with their bounding boxes
        data class TextItem(val text: String, val bounds: Rect)
        val textItems = mutableListOf<TextItem>()

        for (block in text.textBlocks) {
            for (line in block.lines) {
                val lineText = line.text
                allText.append(lineText).append(" ")
                line.boundingBox?.let { bounds ->
                    textItems.add(TextItem(lineText, bounds))
                }
            }
        }

        // Sort by Y position (top to bottom), then X position (left to right)
        textItems.sortWith { a, b ->
            val yDiff = abs(a.bounds.centerY() - b.bounds.centerY())
            if (yDiff < 30) { // Same row threshold
                a.bounds.left - b.bounds.left
            } else {
                a.bounds.top - b.bounds.top
            }
        }

        // Group into rows based on Y position
        val rows = mutableListOf<MutableList<TextItem>>()
        var currentRow = mutableListOf<TextItem>()
        var lastY = -1000

        for (item in textItems) {
            if (abs(item.bounds.centerY() - lastY) > 30) {
                if (currentRow.isNotEmpty()) {
                    rows.add(currentRow.sortedBy { it.bounds.left }.toMutableList())
                }
                currentRow = mutableListOf(item)
            } else {
                currentRow.add(item)
            }
            lastY = item.bounds.centerY()
        }
        if (currentRow.isNotEmpty()) {
            rows.add(currentRow.sortedBy { it.bounds.left }.toMutableList())
        }

        // Determine column count from the row with most items
        val maxColumns = rows.maxOfOrNull { it.size } ?: 0

        // Only create table if we have multiple rows and columns
        if (maxColumns > 1 && rows.size > 1) {
            val tableMap = WritableNativeMap()
            val columnsArray = WritableNativeArray()
            
            // Track column bounds and cells
            val columnBounds = mutableMapOf<Int, Rect>()
            val columnCells = mutableMapOf<Int, WritableArray>()
            var tableBounds: Rect? = null

            for ((rowIdx, row) in rows.withIndex()) {
                for ((colIdx, item) in row.withIndex()) {
                    // Create cell
                    val cellMap = WritableNativeMap()
                    cellMap.putString("text", item.text)
                    cellMap.putMap("boundingBox", createBoundingBoxMap(item.bounds))
                    cellMap.putInt("rowIndex", rowIdx)
                    cellMap.putInt("columnIndex", colIdx)

                    // Update column bounds
                    if (columnBounds[colIdx] == null) {
                        columnBounds[colIdx] = Rect(item.bounds)
                        columnCells[colIdx] = WritableNativeArray()
                    } else {
                        columnBounds[colIdx]!!.union(item.bounds)
                    }
                    (columnCells[colIdx] as WritableNativeArray).pushMap(cellMap)

                    // Update table bounds
                    if (tableBounds == null) {
                        tableBounds = Rect(item.bounds)
                    } else {
                        tableBounds.union(item.bounds)
                    }
                }
            }

            // Build columns array
            for (colIdx in columnBounds.keys.sorted()) {
                val colMap = WritableNativeMap()
                colMap.putMap("boundingBox", createBoundingBoxMap(columnBounds[colIdx]!!))
                colMap.putInt("columnIndex", colIdx)
                colMap.putArray("cells", columnCells[colIdx])
                columnsArray.pushMap(colMap)
            }

            tableMap.putMap("boundingBox", createBoundingBoxMap(tableBounds ?: Rect()))
            tableMap.putArray("columns", columnsArray)
            tableMap.putInt("rowCount", rows.size)
            tableMap.putInt("columnCount", maxColumns)
            tablesArray.pushMap(tableMap)
        }

        result.putArray("tables", tablesArray)
        result.putString("rawText", allText.toString().trim())
        return result
    }

    private fun createBoundingBoxMap(rect: Rect): WritableMap {
        val map = WritableNativeMap()
        map.putDouble("x", rect.left.toDouble())
        map.putDouble("y", rect.top.toDouble())
        map.putDouble("width", rect.width().toDouble())
        map.putDouble("height", rect.height().toDouble())
        return map
    }

    override fun getName(): String {
        return NAME
    }

    companion object {
        const val NAME = "DocumentRecognizerModule"
    }
}
