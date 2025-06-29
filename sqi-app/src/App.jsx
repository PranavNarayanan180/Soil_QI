"use client"

import { useState, useEffect } from "react"
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts"
import {
  Calculator,
  Beaker,
  TrendingUp,
  Info,
  Upload,
  FileSpreadsheet,
  BarChart3,
  CheckCircle,
  RotateCcw,
  ChevronRight,
  Sparkles,
} from "lucide-react"
import * as XLSX from "xlsx"

const SoilQualityModel = () => {
  const [currentStep, setCurrentStep] = useState(1)
  const [excelData, setExcelData] = useState(null)
  const [columnHeaders, setColumnHeaders] = useState([])
  const [pcaResults, setPcaResults] = useState(null)
  const [soilData, setSoilData] = useState({})
  const [calculatedWeights, setCalculatedWeights] = useState({})
  const [sqiResult, setSqiResult] = useState(null)
  const [debugInfo, setDebugInfo] = useState("")

  // Default scoring functions
  const getDefaultScoringFunction = (paramName) => {
    const name = paramName.toLowerCase()
    if (name.includes("ph")) {
      return (value) => {
        if (value >= 6.0 && value <= 7.5) return 100
        if (value >= 5.5 && value < 6.0) return 80 - (6.0 - value) * 40
        if (value > 7.5 && value <= 8.0) return 80 - (value - 7.5) * 40
        if (value < 5.5) return Math.max(0, 60 - (5.5 - value) * 30)
        return Math.max(0, 60 - (value - 8.0) * 30)
      }
    } else if (name.includes("carbon") || name.includes("organic")) {
      return (value) => Math.min(100, (value / 7.5) * 100)
    } else if (name.includes("nitrogen") || name.includes("n")) {
      return (value) => Math.min(100, (value / 480) * 100)
    } else if (name.includes("phosphorus") || name.includes("p")) {
      return (value) => Math.min(100, (value / 22) * 100)
    } else if (name.includes("potassium") || name.includes("k")) {
      return (value) => Math.min(100, (value / 280) * 100)
    } else if (name.includes("conductivity") || name.includes("ec")) {
      return (value) => {
        if (value !=0 && value <= 0.8) return 100
        return Math.max(0, 100 - (value - 0.8) * 50)
      }
    } else if (name.includes("density") || name.includes("bulk")) {
      return (value) => {
        if (value <= 1.5) return 100 - (value - 1.0) * 25
        return Math.max(0, 100 - (value - 1.0) * 50)
      }
    } else if (name.includes("microbial") || name.includes("activity")) {
      return (value) => value
    } else {
      // Generic linear scaling for unknown parameters
      return (value) => Math.min(100, Math.max(0, value))
    }
  }

  // Handle Excel file upload
  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result)
          const workbook = XLSX.read(data, { type: "array" })
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

          if (jsonData.length > 1) {
            const headers = jsonData[0].filter((header) => header !== undefined && header !== "")
            const dataRows = jsonData
              .slice(1)
              .filter((row) => row.some((cell) => cell !== undefined && cell !== ""))
              .map((row) => row.slice(0, headers.length)) // Ensure consistent column count

            setColumnHeaders(headers)
            setExcelData(dataRows)

            // Initialize soil data with zeros for all parameters
            const initialSoilData = {}
            headers.forEach((header) => {
              initialSoilData[header] = 0
            })
            setSoilData(initialSoilData)

            setDebugInfo(`Loaded ${dataRows.length} rows with ${headers.length} columns`)
            setCurrentStep(2)
          }
        } catch (error) {
          console.error("File upload error:", error)
          alert("Error reading Excel file. Please ensure it's a valid Excel file.")
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  // Matrix multiplication helper
  const matrixMultiply = (A, B) => {
    const result = []
    for (let i = 0; i < A.length; i++) {
      result[i] = []
      for (let j = 0; j < B[0].length; j++) {
        let sum = 0
        for (let k = 0; k < B.length; k++) {
          sum += A[i][k] * B[k][j]
        }
        result[i][j] = sum
      }
    }
    return result
  }

  // Matrix transpose helper
  const matrixTranspose = (matrix) => {
    return matrix[0].map((_, colIndex) => matrix.map((row) => row[colIndex]))
  }

  // Power iteration method for finding dominant eigenvector
  const powerIteration = (matrix, iterations = 100) => {
    const n = matrix.length
    let vector = Array(n).fill(1) // Initial vector

    for (let i = 0; i < iterations; i++) {
      // Multiply matrix by vector
      const newVector = matrix.map((row) => row.reduce((sum, val, idx) => sum + val * vector[idx], 0))

      // Normalize vector
      const norm = Math.sqrt(newVector.reduce((sum, val) => sum + val * val, 0))
      if (norm > 0) {
        vector = newVector.map((val) => val / norm)
      }
    }

    // Calculate eigenvalue
    const Av = matrix.map((row) => row.reduce((sum, val, idx) => sum + val * vector[idx], 0))
    const eigenvalue = vector.reduce((sum, val, idx) => sum + val * Av[idx], 0)

    return { vector, eigenvalue }
  }

  // Perform real PCA analysis
  const performPCA = () => {
    if (!excelData || excelData.length === 0) {
      alert("No data available for PCA analysis")
      return
    }

    try {
      setDebugInfo("Starting proper PCA analysis...")

      // Convert data to numeric matrix and handle missing values
      const dataMatrix = excelData.map((row) =>
        row.map((cell, colIndex) => {
          const numValue = Number.parseFloat(cell)
          return isNaN(numValue) ? 0 : numValue
        }),
      )

      // Validate that we have enough data
      if (dataMatrix.length < 2) {
        throw new Error("Need at least 2 rows of data for PCA")
      }

      if (columnHeaders.length < 2) {
        throw new Error("Need at least 2 parameters for PCA")
      }

      setDebugInfo(`Processing ${dataMatrix.length} samples with ${columnHeaders.length} parameters`)

      // Step 1: Calculate means for each feature
      const means = []
      for (let col = 0; col < columnHeaders.length; col++) {
        const column = dataMatrix.map((row) => row[col] || 0)
        const mean = column.reduce((sum, val) => sum + val, 0) / column.length
        means.push(mean)
      }

      // Step 2: Center the data (subtract mean)
      const centeredData = dataMatrix.map((row) => row.map((val, col) => (val || 0) - means[col]))

      setDebugInfo("Data centered, calculating covariance matrix...")

      // Step 3: Calculate covariance matrix
      const n = dataMatrix.length
      const p = columnHeaders.length
      const covarianceMatrix = []

      for (let i = 0; i < p; i++) {
        covarianceMatrix[i] = []
        for (let j = 0; j < p; j++) {
          let covariance = 0
          for (let k = 0; k < n; k++) {
            covariance += centeredData[k][i] * centeredData[k][j]
          }
          covarianceMatrix[i][j] = covariance / (n - 1)
        }
      }

      setDebugInfo("Covariance matrix calculated, finding principal components...")

      // Step 4: Find principal components using power iteration
      const eigenInfo = []
      const tempMatrix = covarianceMatrix.map((row) => [...row]) // Copy matrix

      // Extract multiple principal components
      for (let pc = 0; pc < Math.min(3, p); pc++) {
        const { vector, eigenvalue } = powerIteration(tempMatrix)
        eigenInfo.push({ vector, eigenvalue: Math.abs(eigenvalue) })

        // Deflate matrix for next principal component
        for (let i = 0; i < p; i++) {
          for (let j = 0; j < p; j++) {
            tempMatrix[i][j] -= eigenvalue * vector[i] * vector[j]
          }
        }
      }

      // Step 5: Calculate feature importance based on principal components
      const weights = {}
      const totalEigenvalue = eigenInfo.reduce((sum, info) => sum + info.eigenvalue, 0)

      // Initialize weights
      columnHeaders.forEach((header) => {
        weights[header] = 0
      })

      // Calculate weighted importance from principal components
      eigenInfo.forEach((info, pcIndex) => {
        const pcWeight = info.eigenvalue / totalEigenvalue
        const absLoadings = info.vector.map(Math.abs)
        const totalLoading = absLoadings.reduce((sum, val) => sum + val, 0)

        info.vector.forEach((loading, featureIndex) => {
          const featureName = columnHeaders[featureIndex]
          const normalizedLoading = Math.abs(loading) / totalLoading
          weights[featureName] += pcWeight * normalizedLoading
        })
      })

      // Step 6: Normalize weights to sum to 1
      const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
      if (totalWeight > 0) {
        Object.keys(weights).forEach((key) => {
          weights[key] = weights[key] / totalWeight
        })
      } else {
        // Fallback: equal weights
        const equalWeight = 1 / columnHeaders.length
        Object.keys(weights).forEach((key) => {
          weights[key] = equalWeight
        })
      }

      // Calculate explained variance ratios
      const explainedVarianceRatio = eigenInfo.map((info) => ((info.eigenvalue / totalEigenvalue) * 100).toFixed(2))

      setCalculatedWeights(weights)
      setPcaResults({
        weights,
        means,
        eigenInfo,
        explainedVarianceRatio,
        totalVariance: totalEigenvalue,
      })

      setDebugInfo(
        `PCA completed! PC1: ${explainedVarianceRatio[0]}%, PC2: ${explainedVarianceRatio[1] || "N/A"}%, PC3: ${explainedVarianceRatio[2] || "N/A"}%`,
      )
      setCurrentStep(3)
    } catch (error) {
      console.error("PCA Error:", error)
      setDebugInfo(`PCA Error: ${error.message}`)
      alert(`Error performing PCA analysis: ${error.message}`)
    }
  }

  // Calculate SQI with dynamic parameters
  const calculateSQI = () => {
    if (!pcaResults || Object.keys(soilData).length === 0) return

    let totalScore = 0
    let totalWeight = 0
    const scores = {}

    Object.keys(soilData).forEach((param) => {
      const scoringFunc = getDefaultScoringFunction(param)
      const score = scoringFunc(soilData[param])
      scores[param] = Math.max(0, Math.min(100, score)) // Ensure score is between 0-100

      const weight = calculatedWeights[param] || 0
      totalScore += scores[param] * weight
      totalWeight += weight
    })

    const sqi = (totalWeight > 0 ? totalScore / totalWeight : 0 ) / 100

    let category = ""
    let color = ""
    let gradient = ""
    if (sqi >= 0.6) {
      category = "High"
      color = "#10b981"
      gradient = "from-emerald-500/10 to-green-500/10"
    } else if (sqi >= 0.3) {
      category = "Medium"
      color = "#f59e0b"
      gradient = "from-amber-500/10 to-yellow-500/10"
    } else {
      category = "Low"
      color = "#ef4444"
      gradient = "from-red-500/10 to-rose-500/10"
    }

    setSqiResult({
      sqi: sqi.toFixed(2),
      category,
      color,
      gradient,
      scores,
    })
  }

  useEffect(() => {
    if (currentStep === 3 && Object.keys(soilData).length > 0) {
      calculateSQI()
    }
  }, [soilData, calculatedWeights, currentStep])

  const radarData = sqiResult
    ? Object.keys(soilData).map((key) => ({
        parameter: key.length > 10 ? key.substring(0, 10) + "..." : key,
        score: sqiResult.scores[key],
        fullMark: 100,
      }))
    : []

  const barData = sqiResult
    ? Object.keys(soilData).map((key) => ({
        name: key.length > 8 ? key.substring(0, 8) + "..." : key,
        score: sqiResult.scores[key],
        weight: (calculatedWeights[key] || 0) * 100,
      }))
    : []

  const resetCalculator = () => {
    setCurrentStep(1)
    setExcelData(null)
    setColumnHeaders([])
    setPcaResults(null)
    setSoilData({})
    setCalculatedWeights({})
    setSqiResult(null)
    setDebugInfo("")
  }

  const steps = [
    { id: 1, title: "Upload Dataset", desc: "Upload Excel file with soil data", icon: Upload },
    { id: 2, title: "PCA Analysis", desc: "Analyze data & calculate weights", icon: BarChart3 },
    { id: 3, title: "Calculate SQI", desc: "Input values & get results", icon: Calculator },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Modern Header */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/25">
                  <Beaker className="text-white" size={24} />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                  <Sparkles className="text-white" size={10} />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                  Soil Quality Index Calculator
                </h1>
                <p className="text-slate-600 text-sm">PCA-based soil quality assessment</p>
              </div>
            </div>
            <button
              onClick={resetCalculator}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all duration-200 border border-slate-200"
            >
              <RotateCcw size={16} />
              <span className="text-sm font-medium">Reset</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Minimal Progress Steps */}
        <div className="mb-12">
          <div className="flex items-center justify-between relative">
            <div className="absolute top-6 left-6 right-6 h-px bg-slate-200"></div>
            <div
              className="absolute top-6 left-6 h-px bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-500"
              style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            ></div>

            {steps.map((step, index) => {
              const Icon = step.icon
              const isCompleted = currentStep > step.id
              const isCurrent = currentStep === step.id

              return (
                <div key={step.id} className="flex flex-col items-center relative z-10">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                      isCompleted
                        ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25"
                        : isCurrent
                          ? "bg-white text-slate-700 shadow-lg border-2 border-emerald-500"
                          : "bg-white text-slate-400 shadow-sm border border-slate-200"
                    }`}
                  >
                    {isCompleted ? <CheckCircle size={20} /> : <Icon size={20} />}
                  </div>
                  <div className="mt-3 text-center">
                    <h3
                      className={`font-semibold text-sm ${
                        isCompleted ? "text-emerald-600" : isCurrent ? "text-slate-900" : "text-slate-500"
                      }`}
                    >
                      {step.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">{step.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Debug Info */}
        {debugInfo && (
          <div className="mb-8 bg-blue-50 border border-blue-200 rounded-2xl p-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <p className="text-sm text-blue-800 font-medium">{debugInfo}</p>
            </div>
          </div>
        )}

        {/* Step 1: Excel Upload */}
        {currentStep === 1 && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
            <div className="text-center max-w-2xl mx-auto">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/25">
                <Upload className="text-white" size={28} />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">Upload Your Dataset</h2>
              <p className="text-slate-600 mb-8">
                Upload an Excel file containing your soil parameter data. The first row should contain column headers.
              </p>

              <div className="relative group">
                <div className="border-2 border-dashed border-slate-300 rounded-2xl p-12 hover:border-blue-400 transition-all duration-300 bg-slate-50/50 hover:bg-blue-50/50">
                  <FileSpreadsheet
                    className="mx-auto mb-6 text-slate-400 group-hover:text-blue-500 transition-colors"
                    size={48}
                  />
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-slate-600 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-r file:from-blue-500 file:to-indigo-600 file:text-white hover:file:from-blue-600 hover:file:to-indigo-700 file:shadow-lg file:transition-all file:duration-200"
                  />
                  <p className="mt-4 text-sm text-slate-500">Supports .xlsx and .xls files</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: PCA Analysis */}
        {currentStep === 2 && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center mr-4 shadow-lg shadow-purple-500/25">
                <BarChart3 className="text-white" size={20} />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Principal Component Analysis</h2>
            </div>

            <div className="bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100">
              <h3 className="text-lg font-semibold mb-4 text-slate-800">Dataset Summary</h3>
              <div className="grid md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{columnHeaders.length}</div>
                  <div className="text-sm text-slate-600">Parameters</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-emerald-600">{excelData ? excelData.length : 0}</div>
                  <div className="text-sm text-slate-600">Samples</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">
                    {columnHeaders.length * (excelData ? excelData.length : 0)}
                  </div>
                  <div className="text-sm text-slate-600">Data Points</div>
                </div>
              </div>
              <div className="mt-6 p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                <h4 className="font-semibold text-slate-800 mb-3">Parameters:</h4>
                <div className="flex flex-wrap gap-2">
                  {columnHeaders.map((header, index) => (
                    <span key={index} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                      {header}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={performPCA}
              className="w-full py-4 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-2xl hover:from-purple-600 hover:to-indigo-700 transition-all duration-300 font-semibold text-lg shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/30 transform hover:-translate-y-0.5"
            >
              Perform PCA Analysis & Calculate Weights
            </button>
          </div>
        )}

        {/* Step 3: Input Parameters & Results */}
        {currentStep === 3 && (
          <div className="space-y-8">
            {/* Parameter Input Section */}
            <div className="grid lg:grid-cols-2 gap-8">
              {/* PCA Results */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center mb-6">
                  <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-indigo-500/25">
                    <TrendingUp className="text-white" size={16} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">PCA Results & Weights</h3>
                </div>

                {pcaResults && pcaResults.explainedVarianceRatio && (
                  <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                    <h4 className="font-semibold text-indigo-800 mb-2">Explained Variance</h4>
                    <div className="text-sm text-indigo-700 space-y-1">
                      <div>
                        PC1: <span className="font-bold">{pcaResults.explainedVarianceRatio[0]}%</span>
                      </div>
                      {pcaResults.explainedVarianceRatio[1] && (
                        <div>
                          PC2: <span className="font-bold">{pcaResults.explainedVarianceRatio[1]}%</span>
                        </div>
                      )}
                      {pcaResults.explainedVarianceRatio[2] && (
                        <div>
                          PC3: <span className="font-bold">{pcaResults.explainedVarianceRatio[2]}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {Object.entries(calculatedWeights)
                    .sort(([, a], [, b]) => b - a)
                    .map(([param, weight], index) => (
                      <div
                        key={param}
                        className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100"
                      >
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              index === 0
                                ? "bg-emerald-500"
                                : index === 1
                                  ? "bg-blue-500"
                                  : index === 2
                                    ? "bg-purple-500"
                                    : "bg-slate-400"
                            }`}
                          ></div>
                          <span className="font-medium text-slate-700 text-sm">{param}</span>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-lg text-xs font-bold ${
                            weight > 0.15
                              ? "bg-emerald-100 text-emerald-800"
                              : weight > 0.1
                                ? "bg-amber-100 text-amber-800"
                                : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {(weight * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Input Parameters */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center mb-6">
                  <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-emerald-500/25">
                    <Calculator className="text-white" size={16} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Soil Parameter Values</h3>
                </div>

                <div className="space-y-4 max-h-80 overflow-y-auto">
                  {Object.keys(soilData).map((param) => (
                    <div key={param} className="relative">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">{param}</label>
                      <input
                        type="number"
                        step="0.1"
                        value={soilData[param]}
                        onChange={(e) =>
                          setSoilData((prev) => ({
                            ...prev,
                            [param]: Number.parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all duration-200 bg-white"
                        placeholder="Enter value"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Results Section */}
            {sqiResult && (
              <div className="space-y-8">
                {/* SQI Score Display */}
                <div className="grid md:grid-cols-3 gap-6">
                  <div
                    className={`bg-gradient-to-br ${sqiResult.gradient} rounded-3xl shadow-sm border border-slate-200 p-8 col-span-1`}
                  >
                    <div className="text-center">
                      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <Beaker className="text-slate-600" size={28} />
                      </div>
                      <h3 className="text-lg font-semibold text-slate-700 mb-4">SQI Score</h3>
                      <div className="text-5xl font-bold mb-4" style={{ color: sqiResult.color }}>
                        {sqiResult.sqi}
                      </div>
                      <div
                        className="text-lg font-bold px-6 py-3 rounded-2xl inline-block text-white shadow-lg"
                        style={{ backgroundColor: sqiResult.color }}
                      >
                        {sqiResult.category} Quality
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 col-span-2">
                    <h3 className="text-lg font-semibold text-slate-800 mb-6">Quality Assessment Guide</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="flex items-center p-4 bg-red-50 rounded-xl border border-red-100">
                        <div className="w-3 h-3 bg-red-500 rounded-full mr-3"></div>
                        <div>
                          <div className="font-semibold text-red-800 text-sm">Low Quality</div>
                          <div className="text-xs text-red-600">0 - 50</div>
                        </div>
                      </div>
                      <div className="flex items-center p-4 bg-amber-50 rounded-xl border border-amber-100">
                        <div className="w-3 h-3 bg-amber-500 rounded-full mr-3"></div>
                        <div>
                          <div className="font-semibold text-amber-800 text-sm">Medium Quality</div>
                          <div className="text-xs text-amber-600">50 - 75</div>
                        </div>
                      </div>
                      <div className="flex items-center p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                        <div className="w-3 h-3 bg-emerald-500 rounded-full mr-3"></div>
                        <div>
                          <div className="font-semibold text-emerald-800 text-sm">High Quality</div>
                          <div className="text-xs text-emerald-600">75 - 100</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <h4 className="font-semibold text-blue-800 mb-2 text-sm">Recommendations</h4>
                      <p className="text-sm text-blue-700">
                        {sqiResult.category === "High"
                          ? "Excellent soil quality! Maintain current practices and monitor regularly."
                          : sqiResult.category === "Medium"
                            ? "Good soil quality with room for improvement. Consider targeted amendments."
                            : "Soil quality needs attention. Consider comprehensive soil improvement strategies."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Visualizations */}
                <div className="grid lg:grid-cols-2 gap-8">
                  <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center">
                      <BarChart3 className="mr-2 text-blue-600" size={18} />
                      Parameter Scores & Weights
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={barData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} fontSize={10} stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(255, 255, 255, 0.95)",
                            border: "none",
                            borderRadius: "12px",
                            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.1)",
                          }}
                        />
                        <Legend />
                        <Bar dataKey="score" fill="#10b981" name="Score" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="weight" fill="#3b82f6" name="Weight (%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center">
                      <TrendingUp className="mr-2 text-emerald-600" size={18} />
                      Radar Chart - Parameter Scores
                    </h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="parameter" fontSize={9} stroke="#64748b" />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} fontSize={8} stroke="#64748b" />
                        <Radar
                          name="Score"
                          dataKey="score"
                          stroke="#10b981"
                          fill="#10b981"
                          fillOpacity={0.3}
                          strokeWidth={2}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(255, 255, 255, 0.95)",
                            border: "none",
                            borderRadius: "12px",
                            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.1)",
                          }}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Model Information */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 mt-8">
          <div className="flex items-center mb-6">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mr-3 shadow-lg shadow-blue-500/25">
              <Info className="text-white" size={16} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Model Information</h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 bg-emerald-50 rounded-2xl border border-emerald-100">
              <h3 className="font-bold text-emerald-800 mb-3 text-sm">PCA-Based Weight Calculation</h3>
              <ul className="space-y-2 text-xs text-emerald-700">
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Uses Principal Component Analysis
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Weights based on parameter variance
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Automatic parameter importance ranking
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Data-driven weight assignment
                </li>
              </ul>
            </div>

            <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
              <h3 className="font-bold text-blue-800 mb-3 text-sm">Analysis Workflow</h3>
              <ul className="space-y-2 text-xs text-blue-700">
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Upload Excel dataset
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Perform PCA analysis
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Calculate parameter weights
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Input current soil values
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Get SQI with visualizations
                </li>
              </ul>
            </div>

            <div className="p-6 bg-purple-50 rounded-2xl border border-purple-100 md:col-span-2 lg:col-span-1">
              <h3 className="font-bold text-purple-800 mb-3 text-sm">Key Features</h3>
              <ul className="space-y-2 text-xs text-purple-700">
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Dynamic parameter handling
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Real-time visualization
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Scientific scoring functions
                </li>
                <li className="flex items-start">
                  <ChevronRight className="w-3 h-3 mt-0.5 mr-2 flex-shrink-0" />
                  Comprehensive reporting
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SoilQualityModel
