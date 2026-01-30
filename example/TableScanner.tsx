import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { DualImageRecognizer } from 'react-native-vision-camera-ocr-plus';
import Share from 'react-native-share';

export default function TableScanner() {
  const [leftImage, setLeftImage] = useState<string | null>(null);
  const [rightImage, setRightImage] = useState<string | null>(null);
  const [csv, setCsv] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const pickImage = async (side: 'left' | 'right') => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 1,
    });

    if (result.assets && result.assets[0].uri) {
      if (side === 'left') {
        setLeftImage(result.assets[0].uri);
      } else {
        setRightImage(result.assets[0].uri);
      }
    }
  };

  const processImages = async () => {
    if (!leftImage || !rightImage) {
      Alert.alert('Error', 'Please select both left and right images');
      return;
    }

    setLoading(true);
    try {
      const result = await DualImageRecognizer({
        leftUri: leftImage,
        rightUri: rightImage,
      });
      setCsv(result.csv);
      Alert.alert('Success', 'Table extracted successfully!');
    } catch (error) {
      Alert.alert('Error', `Failed to process images: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const shareCSV = async () => {
    if (!csv) return;
    
    try {
      await Share.open({
        title: 'Export CSV',
        message: csv,
        type: 'text/csv',
      });
    } catch (error) {
      console.log('Share cancelled');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Flight Log Table Scanner</Text>
      
      <View style={styles.section}>
        <Text style={styles.label}>Left Page</Text>
        <TouchableOpacity style={styles.button} onPress={() => pickImage('left')}>
          <Text style={styles.buttonText}>
            {leftImage ? '✓ Left Image Selected' : 'Pick Left Image'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Right Page</Text>
        <TouchableOpacity style={styles.button} onPress={() => pickImage('right')}>
          <Text style={styles.buttonText}>
            {rightImage ? '✓ Right Image Selected' : 'Pick Right Image'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.button, styles.processButton, (!leftImage || !rightImage || loading) && styles.disabled]}
        onPress={processImages}
        disabled={!leftImage || !rightImage || loading}
      >
        <Text style={styles.buttonText}>
          {loading ? 'Processing...' : 'Extract Table'}
        </Text>
      </TouchableOpacity>

      {csv && (
        <>
          <TouchableOpacity style={[styles.button, styles.shareButton]} onPress={shareCSV}>
            <Text style={styles.buttonText}>Share CSV</Text>
          </TouchableOpacity>
          
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>CSV Preview:</Text>
            <ScrollView horizontal>
              <Text style={styles.csvText}>{csv.substring(0, 500)}...</Text>
            </ScrollView>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    marginBottom: 10,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  processButton: {
    backgroundColor: '#34C759',
    marginTop: 20,
  },
  shareButton: {
    backgroundColor: '#FF9500',
    marginTop: 10,
  },
  disabled: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  preview: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  csvText: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
});
