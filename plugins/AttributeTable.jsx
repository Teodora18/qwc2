/**
 * Copyright 2021 Sourcepole AG
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import {connect} from 'react-redux';
import geojsonBbox from 'geojson-bounding-box';
import isEmpty from 'lodash.isempty';
import ContentEditable from 'react-contenteditable';
import {getFeatureTemplate} from '../actions/editing';
import {LayerRole} from '../actions/layers';
import {zoomToExtent} from '../actions/map';
import {setCurrentTask, setCurrentTaskBlocked} from '../actions/task';
import EditComboField, {KeyValCache} from '../components/EditComboField';
import EditUploadField from '../components/EditUploadField';
import Icon from '../components/Icon';
import ResizeableWindow from '../components/ResizeableWindow';
import Spinner from '../components/Spinner';
import NavBar from '../components/widgets/NavBar';
import ConfigUtils from '../utils/ConfigUtils';
import EditingInterface from '../utils/EditingInterface';
import CoordinatesUtils from '../utils/CoordinatesUtils';
import LayerUtils from '../utils/LayerUtils';
import LocaleUtils from '../utils/LocaleUtils';
import './style/AttributeTable.css';


class AttributeTable extends React.Component {
    static propTypes = {
        active: PropTypes.bool,
        allowAddForGeometryLayers: PropTypes.bool,
        iface: PropTypes.object,
        layers: PropTypes.array,
        mapCrs: PropTypes.string,
        setCurrentTask: PropTypes.func,
        setCurrentTaskBlocked: PropTypes.func,
        taskData: PropTypes.object,
        theme: PropTypes.object,
        zoomToExtent: PropTypes.func
    }
    static defaultState = {
        loading: false,
        selectedLayer: "",
        loadedLayer: "",
        features: [],
        filteredSortedFeatures: [],
        selectedFeatures: {},
        changedFeatureIdx: null,
        originalFeatureProps: null,
        pageSize: 50,
        currentPage: 0,
        filterField: "id",
        filterOp: "~",
        filterVal: "",
        sortField: null,
        deleteTask: null,
        newFeature: false,
        confirmDelete: false
    }
    constructor(props) {
        super(props);
        this.changedFiles = {};
        this.state = AttributeTable.defaultState;
        this.table = null;
        this.attribTableContents = null;
    }
    componentDidUpdate(prevProps, prevState) {
        if (this.state.newFeature && !prevState.newFeature) {
            if (this.attribTableContents) {
                this.attribTableContents.scrollTop = this.attribTableContents.scrollHeight;
            }
        }
        if (!this.props.active && prevProps.active) {
            this.setState(AttributeTable.defaultState);
        } else if (this.props.active && !prevProps.active && this.props.taskData && this.props.taskData.layer) {
            this.reload(this.props.taskData.layer);
        }
    }
    render() {
        if (!this.props.active) {
            return null;
        }

        const editConfig = this.props.theme.editConfig || {};
        const currentEditConfig = editConfig[this.state.loadedLayer];
        const editPermissions = (editConfig[this.state.loadedLayer] || {}).permissions || {};
        const readOnly = editPermissions.updatable === false;

        let loadOverlay = null;
        if (this.state.selectedLayer && this.state.selectedLayer !== this.state.loadedLayer) {
            if (this.state.loading) {
                loadOverlay = (
                    <div className="attribtable-overlay">
                        <Spinner /><span>{LocaleUtils.tr("attribtable.loading")}</span>
                    </div>
                );
            } else {
                loadOverlay = (
                    <div className="attribtable-overlay">
                        <span>{LocaleUtils.tr("attribtable.pleasereload")}</span>
                    </div>
                );
            }
        } else if (this.state.selectedLayer && this.state.deleteTask) {
            loadOverlay = (
                <div className="attribtable-overlay">
                    <Spinner /><span>{LocaleUtils.tr("attribtable.deleting")}</span>
                </div>
            );
        }
        let table = null;
        let footbar = null;
        if (currentEditConfig && this.state.features) {
            const fields = currentEditConfig.fields.reduce((res, field) => {
                if (field.id !== "id") {
                    res.push(field);
                }
                return res;
            }, []);

            const editDataset = this.editLayerId(this.state.selectedLayer);
            const mapPrefix = editDataset.replace(new RegExp("." + this.state.selectedLayer + "$"), ".");
            const indexOffset = this.state.currentPage * this.state.pageSize;
            const features = this.state.filteredSortedFeatures.slice(indexOffset, indexOffset + this.state.pageSize);
            table = (
                <table className="attribtable-table" ref={el => { this.table = el; }}>
                    <thead>
                        <tr>
                            <th />
                            <th onClick={() => this.sortBy("id")}>
                                <span>
                                    <span className="attribtable-table-headername">id</span>
                                    {this.renderSortIndicator("id")}
                                    {this.renderColumnResizeHandle(1, 'r')}
                                </span>
                            </th>
                            {fields.map((field, idx) => (
                                <th key={field.id} onClick={() => this.sortBy(field.id)}>
                                    <span>
                                        {this.renderColumnResizeHandle(idx + 1, 'l')}
                                        <span className="attribtable-table-headername">{field.name}</span>
                                        {this.renderSortIndicator(field.id)}
                                        {idx < fields.length - 1 ? this.renderColumnResizeHandle(idx + 2, 'r') : null}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {features.map((feature, filteredIndex) => {
                            const featureidx = feature.originalIndex;
                            const disabled = readOnly || (this.state.changedFeatureIdx !== null && this.state.changedFeatureIdx !== featureidx);
                            const key = this.state.changedFeatureIdx === featureidx && this.state.newFeature ? "newfeature" : feature.id;
                            return (
                                <tr className={disabled ? "row-disabled" : ""} key={key}>
                                    <td>
                                        <span>
                                            {filteredIndex > 0 ? this.renderRowResizeHandle(filteredIndex, 't') : null}
                                            {<input checked={this.state.selectedFeatures[feature.id] === true} onChange={(ev) => this.setState({selectedFeatures: {...this.state.selectedFeatures, [feature.id]: ev.target.checked}})} type="checkbox" />}
                                            {this.renderRowResizeHandle(filteredIndex + 1, 'b')}
                                        </span>
                                    </td>
                                    <td>{feature.id}</td>
                                    {fields.map(field => (
                                        <td key={field.id}>
                                            {this.renderField(field, featureidx, indexOffset + filteredIndex, disabled || (!!this.state.filterVal && field.id === this.state.filterField), mapPrefix)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            );
            const npages = Math.ceil(this.state.filteredSortedFeatures.length / this.state.pageSize);
            const pages = [this.state.currentPage];
            const extraright = Math.max(0, 2 - this.state.currentPage);
            const extraleft = Math.max(0, this.state.currentPage - (npages - 3));
            for (let i = 0; i < 3 + extraleft; ++i) {
                if (this.state.currentPage - i > 0) {
                    pages.unshift(this.state.currentPage - i);
                }
            }
            for (let i = 0; i < 3 + extraright; ++i) {
                if (this.state.currentPage + i < npages - 1) {
                    pages.push(this.state.currentPage - i + 1);
                }
            }
            footbar = (
                <div className="attribtable-footbar">
                    <NavBar
                        currentPage={this.state.currentPage} disabled={this.state.changedFeatureIdx !== null}
                        nPages={npages} pageChanged={currentPage => this.setState({currentPage})}
                        pageSize={this.state.pageSize} pageSizeChanged={pageSize => this.setState({pageSize})} />

                    <div className="attribtable-filter">
                        <Icon icon="filter" />
                        <select disabled={this.state.changedFeatureIdx !== null} onChange={ev => this.updateFilter("filterField", ev.target.value)} value={this.state.filterField}>
                            <option value="id">id</option>
                            {fields.map(field => (
                                <option key={field.id} value={field.id}>{field.name}</option>
                            ))}
                        </select>
                        <select disabled={this.state.changedFeatureIdx !== null} onChange={ev => this.updateFilter("filterOp", ev.target.value)} value={this.state.filterOp}>
                            <option value="~">~</option>
                            <option value="=">=</option>
                        </select>
                        <input disabled={this.state.changedFeatureIdx !== null} onChange={ev => this.updateFilter("filterVal", ev.target.value, true)} type="text" value={this.state.filterVal} />
                        <button className="button" disabled={this.state.changedFeatureIdx !== null} onClick={() => this.updateFilter("filterVal", "")} value={this.state.filterValue}><Icon icon="clear" /></button>
                    </div>
                </div>
            );
        }
        const nolayer = !this.state.selectedLayer;
        const loading = this.state.loading;
        const editing = this.state.changedFeatureIdx !== null;
        const layerChanged = this.state.selectedLayer !== this.state.loadedLayer;
        const showAddButton = editPermissions.creatable !== false;
        const showDelButton = editPermissions.deletable !== false;

        return (
            <ResizeableWindow dockable="bottom" icon="editing" initialHeight={480} initialWidth={800} onClose={this.onClose} title={LocaleUtils.tr("attribtable.title")}>
                <div className="attribtable-body" role="body">
                    {loadOverlay}
                    <div className="attribtable-toolbar">
                        <span>{LocaleUtils.tr("attribtable.layer")}</span>
                        <select disabled={loading || editing} onChange={ev => this.changeSelectedLayer(ev.target.value)} value={this.state.selectedLayer || ""}>
                            <option disabled value="">{LocaleUtils.tr("attribtable.selectlayer")}</option>
                            {Object.keys(editConfig).map(layerId => {
                                const layerName = editConfig[layerId].layerName;
                                const match = LayerUtils.searchLayer(this.props.layers, 'name', layerName, [LayerRole.THEME]);
                                return (
                                    <option key={layerId} value={layerId}>{match ? match.sublayer.title : layerName}</option>
                                );
                            })}
                        </select>
                        <button className="button" disabled={editing || nolayer} onClick={() => this.reload()} title={LocaleUtils.tr("attribtable.reload")}>
                            <Icon icon="refresh" />
                        </button>
                        {showAddButton ? (
                            <button className="button" disabled={nolayer || editing || loading || layerChanged} onClick={this.addFeature} title={LocaleUtils.tr("attribtable.addfeature")}>
                                <Icon icon="plus" />
                            </button>
                        ) : null}
                        <button className="button" disabled={layerChanged || !Object.values(this.state.selectedFeatures).find(entry => entry === true)} onClick={this.zoomToSelection} title={LocaleUtils.tr("attribtable.zoomtoselection")}>
                            <Icon icon="search" />
                        </button>
                        {ConfigUtils.havePlugin("Editing") ? (
                            <button className="button" disabled={layerChanged || editing || Object.values(this.state.selectedFeatures).filter(entry => entry === true).length !== 1} onClick={this.switchToFormEditMode} title={LocaleUtils.tr("attribtable.formeditmode")}>
                                <Icon icon="editing" />
                            </button>
                        ) : null}
                        {this.state.confirmDelete ? (
                            <button className="button button-accept" onClick={this.deleteSelectedFeatured}>
                                <Icon icon="ok" />
                                <span>{LocaleUtils.tr("attribtable.delete")}</span>
                            </button>
                        ) : (
                            showDelButton ? (<button className="button" disabled={layerChanged || editing || !Object.values(this.state.selectedFeatures).find(entry => entry === true)} onClick={() => this.setState({confirmDelete: true})} title={LocaleUtils.tr("attribtable.deletefeatures")}>
                                <Icon icon="trash" />
                            </button>
                        ) : null
                        )}
                        {this.state.confirmDelete ? (
                            <button className="button button-reject" onClick={() => this.setState({confirmDelete: false})}>
                                <Icon icon="remove" />
                                <span>{LocaleUtils.tr("attribtable.nodelete")}</span>
                            </button>
                        ) : null}
                        {this.state.changedFeatureIdx !== null ? (
                            <button className="button button-accept" onClick={this.commit}>
                                <Icon icon="ok" />
                                <span>{LocaleUtils.tr("attribtable.commit")}</span>
                            </button>
                        ) : null}
                        {this.state.changedFeatureIdx !== null ? (
                            <button className="button button-reject" onClick={this.discard}>
                                <Icon icon="remove" />
                                <span>{LocaleUtils.tr("attribtable.discard")}</span>
                            </button>
                        ) : null}
                    </div>
                    <div className="attribtable-contents" ref={el => {this.attribTableContents = el;}}>
                        {table}
                    </div>
                    {footbar}
                </div>
            </ResizeableWindow>
        );
    }
    renderSortIndicator = (field) => {
        if (this.state.sortField && this.state.sortField.field === field) {
            return (<Icon icon={this.state.sortField.dir > 0 ? "chevron-down" : "chevron-up"} />);
        } else {
            return null;
        }
    }
    renderColumnResizeHandle = (col, pos) => {
        return (
            <span className={"attribtable-table-" + pos + "draghandle"}
                onClick={ev => { ev.preventDefault(); ev.stopPropagation(); }}
                onMouseDown={(ev) => this.resizeTable(ev, col, true)} />
        );
    }
    renderRowResizeHandle = (row, pos) => {
        return (
            <span className={"attribtable-table-" + pos + "draghandle"}
                onClick={ev => { ev.preventDefault(); ev.stopPropagation(); }}
                onMouseDown={(ev) => this.resizeTable(ev, row, false)} />
        );
    }
    onClose = () => {
        if (this.state.changedFeatureIdx === null) {
            this.setState(AttributeTable.defaultState);
            this.props.setCurrentTask(null);
        }
    }
    changeSelectedLayer = (value) => {
        this.setState({selectedLayer: value});
    }
    reload = (layer = null) => {
        const selectedLayer = layer || this.state.selectedLayer;
        this.setState({...AttributeTable.defaultState, loading: true, selectedLayer: selectedLayer});
        KeyValCache.clear();
        this.props.iface.getFeatures(this.editLayerId(selectedLayer), this.props.mapCrs, (result) => {
            if (result) {
                const features = result.features || [];
                this.setState({loading: false, features: features, filteredSortedFeatures: this.filteredSortedFeatures(features, this.state), loadedLayer: selectedLayer});
            } else {
                // eslint-disable-next-line
                alert(LocaleUtils.tr("attribtable.loadfailed"));
                this.setState({loading: false, features: [], filteredSortedFeatures: [], loadedLayer: ""});
            }
        });
    }
    sortBy = (field) => {
        let newState = {};
        if (this.state.sortField && this.state.sortField.field === field) {
            newState = {sortField: {field: field, dir: -this.state.sortField.dir}};
        } else {
            newState = {sortField: {field: field, dir: 1}};
        }
        newState.filteredSortedFeatures = this.filteredSortedFeatures(this.state.features, {...this.state, ...newState});
        this.setState(newState);
    }
    editLayerId = (layerId) => {
        if (this.props.theme && this.props.theme.editConfig && this.props.theme.editConfig[layerId]) {
            return this.props.theme.editConfig[layerId].editDataset || layerId;
        }
        return layerId;
    }
    renderField = (field, featureidx, filteredIndex, fielddisabled, mapPrefix) => {
        const feature = this.state.features[featureidx];
        let value = feature.properties[field.id];
        if (value === undefined || value === null) {
            value = "";
        }
        const updateField = (fieldid, val, emptynull = false) => this.updateField(featureidx, filteredIndex, fieldid, val, emptynull);
        const constraints = field.constraints || {};
        const disabled = constraints.readOnly || fielddisabled;
        let input = null;
        if (field.type === "boolean" || field.type === "bool") {
            input = (<input name={field.id} {...constraints} checked={value} disabled={disabled} onChange={ev => updateField(field.id, ev.target.checked)} type="checkbox" />);
        } else if (constraints.values || constraints.keyvalrel) {
            input = (
                <EditComboField
                    editIface={this.props.iface} fieldId={field.id} keyvalrel={constraints.keyvalrel}
                    name={field.id} readOnly={constraints.readOnly || disabled} required={constraints.required}
                    updateField={updateField} value={value} values={constraints.values} />
            );
        } else if (field.type === "number") {
            const precision = constraints.step > 0 ? Math.ceil(-Math.log10(constraints.step)) : 6;
            input = (
                <input disabled={disabled} max={constraints.max} min={constraints.min}
                    name={field.id} onChange={ev => updateField(field.id, ev.target.value, true)}
                    precision={precision} readOnly={constraints.readOnly} required={constraints.required}
                    step={constraints.step || 1} type="number" value={value} />
            );
        } else if (field.type === "date") {
            // Truncate time portion of ISO date string
            value = value.substr(0, 10);
            input = (
                <input disabled={disabled} name={field.id} type={field.type} {...constraints}
                    onChange={(ev) => updateField(field.id, ev.target.value, true)}
                    value={value} />
            );
        } else if (field.type === "file") {
            return (<EditUploadField constraints={constraints} dataset={this.editLayerId(this.state.selectedLayer)} disabled={disabled} fieldId={field.id} name={field.id} showThumbnails={false} updateField={updateField} updateFile={(fieldId, data) => {this.changedFiles[fieldId] = data; }} value={value} />);
        } else if (field.type === "text") {
            if (constraints.multiline) {
                input = [
                    (<input className="attribtable-content-editable-hiddeninput" key={field.id + "_input"} name={field.id} readOnly required={constraints.required} type="text" value={value} />),
                    (<ContentEditable className="attribtable-content-editable" disabled={disabled} html={value} key={field.id + "_div"} onChange={(ev) => updateField(field.id, ev.target.value)} />)
                ];
            } else {
                input = (
                    <input disabled={disabled} name={field.id}
                        onChange={(ev) => updateField(field.id, ev.target.value)}
                        required={constraints.required} type={field.type} value={value}/>
                );
            }
        } else {
            input = (
                <input disabled={disabled} name={field.id} type={field.type} {...constraints}
                    onChange={(ev) => updateField(field.id, ev.target.value)}
                    value={value}/>
            );
        }
        return input;
    }
    addFeature = () => {
        const editConfig = this.props.theme.editConfig || {};
        const currentEditConfig = editConfig[this.state.loadedLayer];
        if (!currentEditConfig) {
            return;
        }
        const hasGeometry = (currentEditConfig || {}).geomType !== null;
        if (!this.props.allowAddForGeometryLayers && hasGeometry) {
            // eslint-disable-next-line
            alert(LocaleUtils.tr("attribtable.geomnoadd"));
            return;
        }
        const feature = getFeatureTemplate(currentEditConfig.editDataset, {
            type: "Feature",
            geometry: null,
            properties: currentEditConfig.fields.reduce((res, field) => {
                if (field.id !== "id") {
                    res[field.id] = field.type === "text" ? "" : null;
                }
                return res;
            }, {})
        });
        this.setState({
            features: [...this.state.features, feature],
            filteredSortedFeatures: [...this.state.filteredSortedFeatures, {...feature, originalIndex: this.state.features.length}],
            filterVal: "",
            currentPage: Math.floor(this.state.features.length / this.state.pageSize),
            changedFeatureIdx: this.state.filteredSortedFeatures.length,
            newFeature: true
        });
        this.props.setCurrentTaskBlocked(true, LocaleUtils.tr("editing.unsavedchanged"));
    }
    deleteSelectedFeatured = () => {
        const features = this.state.filteredSortedFeatures.filter(feature => this.state.selectedFeatures[feature.id] === true);
        this.setState({deleteTask: {
            pending: features.map(feature => feature.id),
            failed: [],
            deleted: []
        }});
        features.forEach(feature => {
            this.props.iface.deleteFeature(this.editLayerId(this.state.selectedLayer), feature.id, (success) => {
                const newState = {
                    deleteTask: {
                        ...this.state.deleteTask,
                        pending: this.state.deleteTask.pending.filter(entry => entry !== feature.id),
                        failed: success ? this.state.deleteTask.failed : [...this.state.deleteTask.failed, feature.id],
                        deleted: !success ? this.state.deleteTask.deleted : [...this.state.deleteTask.deleted, feature.id]
                    }
                };
                if (isEmpty(newState.deleteTask.pending)) {
                    newState.features = this.state.features.filter(f => !newState.deleteTask.deleted.includes(f.id));
                    newState.filteredSortedFeatures = this.filteredSortedFeatures(newState.features, this.state);
                    if (!isEmpty(newState.deleteTask.failed)) {
                        // eslint-disable-next-line
                        alert(LocaleUtils.tr("attribtable.deletefailed"));
                    }
                    newState.deleteTask = null;
                    newState.currentPage = Math.floor((newState.features.length - 1) / this.state.pageSize);
                    newState.selectedFeatures = {};
                    newState.confirmDelete = false;
                }
                this.setState(newState);
            });
        });
    }
    updateField = (featureidx, filteredIdx, fieldid, value, emptynull) => {
        value = value === "" && emptynull ? null : value;
        const newFeatures = [...this.state.features];
        newFeatures[featureidx] = {...newFeatures[featureidx]};
        newFeatures[featureidx].properties = {...newFeatures[featureidx].properties, [fieldid]: value};
        const newfilteredSortedFeatures = [...this.state.filteredSortedFeatures];
        newfilteredSortedFeatures[filteredIdx] = {...newfilteredSortedFeatures[filteredIdx]};
        newfilteredSortedFeatures[filteredIdx].properties = {...newfilteredSortedFeatures[filteredIdx].properties, [fieldid]: value};
        const originalFeatureProps = this.state.originalFeatureProps || {...this.state.features[featureidx].properties};
        this.setState({features: newFeatures, filteredSortedFeatures: newfilteredSortedFeatures, changedFeatureIdx: featureidx, originalFeatureProps: originalFeatureProps});
        this.props.setCurrentTaskBlocked(true, LocaleUtils.tr("editing.unsavedchanged"));
    }
    commit = () => {
        const feature = {
            ...this.state.features[this.state.changedFeatureIdx],
            crs: {
                type: "name",
                properties: {name: CoordinatesUtils.toOgcUrnCrs(this.props.mapCrs)}
            }
        };
        const featureData = new FormData();
        featureData.set('feature', JSON.stringify(feature));
        Object.entries(this.changedFiles).forEach(([key, value]) => featureData.set('file:' + key, value));

        if (this.state.newFeature) {
            this.props.iface.addFeatureMultipart(
                this.editLayerId(this.state.selectedLayer), featureData,
                (success, result) => this.featureCommited(success, result)
            );
        } else {
            this.props.iface.editFeatureMultipart(
                this.editLayerId(this.state.loadedLayer), feature.id, featureData,
                (success, result) => this.featureCommited(success, result)
            );
        }
    }
    featureCommited = (success, result) => {
        if (!success) {
            // eslint-disable-next-line
            alert(result);
        } else {
            const newFeatures = [...this.state.features];
            newFeatures[this.state.changedFeatureIdx] = result;
            this.changedFiles = {};
            this.setState({features: newFeatures, filteredSortedFeatures: this.filteredSortedFeatures(newFeatures, this.state), changedFeatureIdx: null, originalFeatureProps: null, newFeature: false});
        }
        this.props.setCurrentTaskBlocked(false);
    }
    discard = () => {
        const newFeatures = [...this.state.features];
        if (this.state.newFeature) {
            newFeatures.splice(this.state.changedFeatureIdx, 1);
        } else {
            const featureidx = this.state.changedFeatureIdx;
            newFeatures[featureidx] = {...newFeatures[featureidx]};
            newFeatures[featureidx].properties = this.state.originalFeatureProps;
        }
        this.changedFiles = {};
        this.setState({features: newFeatures, filteredSortedFeatures: this.filteredSortedFeatures(newFeatures, this.state), changedFeatureIdx: null, originalFeatureProps: null, newFeature: false});
        this.props.setCurrentTaskBlocked(false);
    }
    zoomToSelection = () => {
        const collection = {
            type: "FeatureCollection",
            features: this.state.filteredSortedFeatures.filter(feature => this.state.selectedFeatures[feature.id] === true && feature.geometry)
        };
        if (!isEmpty(collection.features)) {
            this.props.zoomToExtent(geojsonBbox(collection), this.props.mapCrs);
        }
    }
    switchToFormEditMode = () => {
        const editConfig = this.props.theme.editConfig || {};
        const currentEditConfig = editConfig[this.state.loadedLayer];
        const hasGeometry = (currentEditConfig || {}).geomType !== null;
        if (!hasGeometry) {
            // eslint-disable-next-line
            alert(LocaleUtils.tr("attribtable.nogeomnoform"));
            return;
        }
        const feature = this.state.filteredSortedFeatures.find(f => this.state.selectedFeatures[f.id] === true);
        this.props.setCurrentTask("Editing", null, null, {layer: this.state.loadedLayer, feature: feature});
    }
    updateFilter = (state, val, resetPage = false) => {
        const newState = {...this.state, [state]: val};
        this.setState({
            [state]: val,
            currentPage: resetPage ? 0 : this.state.currentPage,
            filteredSortedFeatures: this.filteredSortedFeatures(this.state.features, {...this.state, ...newState})
        });
    }
    filteredSortedFeatures = (features, state) => {
        let filteredFeatures = [];
        if (!state.filterVal) {
            filteredFeatures = features.map((feature, idx) => ({...feature, originalIndex: idx}));
        } else {
            const filterVal = state.filterVal.toLowerCase();
            let test = null;
            if (state.filterOp === "~") {
                test = (x) => (String(x).toLowerCase().includes(filterVal));
            } else if (state.filterOp === "=") {
                test = (x) => (String(x).toLowerCase() === filterVal);
            }
            // Build value relation lookup
            const editConfig = this.props.theme.editConfig || {};
            const currentEditConfig = editConfig[this.state.loadedLayer];
            const valueLookup = currentEditConfig.fields.reduce((res, field) => {
                if (field.constraints && field.constraints.values) {
                    res[field.id] = field.constraints.values.reduce((res2, constraint) => {
                        res2[constraint.value] = constraint.label;
                        return res2;
                    }, {});
                } else if (field.constraints && field.constraints.keyvalrel) {
                    res[field.id] = KeyValCache.getSync(field.constraints.keyvalrel).reduce((res2, entry) => {
                        res2[entry.value] = entry.label;
                        return res2;
                    }, {});
                }
                return res;
            }, {});
            const filterFieldValue = state.filterField === "id" ? (feature) => feature.id : (feature) => {
                const value = feature.properties[state.filterField];
                return valueLookup[state.filterField] ? valueLookup[state.filterField][value] : value;
            };
            filteredFeatures = features.reduce((res, feature, idx) => {
                if (test(filterFieldValue(feature))) {
                    res.push({...feature, originalIndex: idx});
                }
                return res;
            }, []);
        }
        if (state.sortField) {
            const sortFieldValue = state.sortField.field === "id" ? (feature) => feature.id : (feature) => feature.properties[state.sortField.field];
            return filteredFeatures.sort((f1, f2) => {
                const v1 = String(sortFieldValue(f1));
                const v2 = String(sortFieldValue(f2));
                return v1.localeCompare(v2, undefined, {numeric: true, sensitivity: 'base'}) * state.sortField.dir;
            });
        } else {
            return filteredFeatures;
        }
    }
    resizeTable = (ev, index, resizeCol) => {
        if (this.table) {
            const element = this.table.getElementsByTagName(resizeCol ? "th" : "tr")[index];
            const resize = {
                anchor: resizeCol ? ev.clientX : ev.clientY,
                element: element,
                initial: resizeCol ? element.clientWidth : element.clientHeight
            };
            const resizeDo = resizeCol ? (event) => {
                const delta = event.clientX - resize.anchor;
                resize.element.style.minWidth = Math.max((resize.initial + delta), 16) + "px";
            } : (event) => {
                const delta = event.clientY - resize.anchor;
                resize.element.style.height = Math.max((resize.initial + delta), 16) + "px";
            };
            document.body.classList.add(resizeCol ? 'ewresizing' : 'nsresizing');
            document.addEventListener("mousemove", resizeDo);
            document.addEventListener("mouseup", (event) => {
                document.removeEventListener("mousemove", resizeDo);
                event.preventDefault();
                event.stopPropagation();
                document.body.classList.remove(resizeCol ? 'ewresizing' : 'nsresizing');
            }, {once: true, capture: true});
            ev.preventDefault();
            ev.stopPropagation();
        }
    }
}

export default (iface = EditingInterface) => {
    return connect((state) => ({
        active: state.task.id === "AttributeTable",
        iface: iface,
        layers: state.layers.flat,
        mapCrs: state.map.projection,
        taskData: state.task.id === "AttributeTable" ? state.task.data : null,
        theme: state.theme.current
    }), {
        setCurrentTask: setCurrentTask,
        setCurrentTaskBlocked: setCurrentTaskBlocked,
        zoomToExtent: zoomToExtent
    })(AttributeTable);
};
